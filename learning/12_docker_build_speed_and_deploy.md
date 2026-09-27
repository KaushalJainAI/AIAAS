# 12 — Docker Build Speed & Deploy Throughput

Why our cold backend image build took ~10 minutes, where the time actually went, and which fixes are worth it. Real numbers from the AIAAS deploys, not theoretical.

---

## The baseline build profile (before optimization)

| Step | Wall time | What's happening |
|---|---|---|
| `apt-get install build-essential libpq-dev` (builder stage) | ~25s | Downloads ~95 MB of .debs |
| `apt-get install libpq5 libmagic1 curl` (runtime stage) | ~17s | Smaller runtime deps |
| `pip install` (~200 packages incl. torch CPU, transformers, scipy, faiss, langchain) | **~250s** | Single biggest cost |
| `COPY . .` (app source, post .dockerignore) | ~7s | 187 KB after the ignore was tightened |
| Image export (multi-stage `COPY --from=builder site-packages` → layer tar) | **~125s** | ~4 GB of `.so`/`.py` files becoming one giant layer |
| **Total cold build** | **~10 min** | |
| Code-only rebuild (cache hot, requirements unchanged) | ~3 min | Mostly the export step |

**Two costs dominate: pip install and image export.** Everything else is noise.

---

## Where time was *being wasted*

### 1. `--no-cache-dir` thrown away pip's wheel cache every build

Original Dockerfile:
```dockerfile
ENV PIP_NO_CACHE_DIR=1
RUN pip install --no-cache-dir -r requirements-linux.txt
```

`--no-cache-dir` made sense in single-stage builds to keep the final image small. But we have a **multi-stage build** — the builder stage's site-packages is what gets copied to runtime, the rest of the builder is thrown away. The pip wheel cache lives in `/root/.cache/pip`, which is never copied. Disabling the cache only forces every single rebuild to re-download all 200 packages from PyPI.

### 2. No BuildKit cache mount on apt or pip

Without `--mount=type=cache`, every fresh build re-downloads the same .debs and .whls from the internet. Even with the same `requirements-linux.txt`, if anything above the pip layer invalidates (a Dockerfile edit, a base image refresh), pip starts from scratch.

### 3. SCP shipped an uncompressed 2.4 GB tar over a slow upstream

`docker save -o image.tar` produces an uncompressed archive. With our home upstream at ~1–2 Mbps, that's 30–60 minutes per deploy.

### 4. The Docker Hub push kept failing on the 5 GB pip layer

Docker Desktop on Windows uses vpnkit as its userspace network stack. vpnkit chokes on long-running HTTP uploads of large blobs — our `d1cb78a55978` pip layer killed three push attempts in a row before we gave up and switched to scp.

---

## Fixes ranked by ROI

### Fix #1 — BuildKit cache mounts for apt + pip

```dockerfile
# syntax=docker/dockerfile:1.7

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
    && apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev

RUN --mount=type=cache,target=/root/.cache/pip,sharing=locked \
    pip install --upgrade pip \
    && pip install --index-url https://download.pytorch.org/whl/cpu torch==2.11.0 \
    && pip install -r requirements-linux.txt
```

What changed:
- Removed `--no-cache-dir` and `PIP_NO_CACHE_DIR=1`
- Added `--mount=type=cache` for both apt and pip caches
- Removed `rm -rf /var/lib/apt/lists/*` — the cache mount handles cleanup; the lists themselves don't end up in the final image because runtime is a fresh stage anyway

The `rm -f /etc/apt/apt.conf.d/docker-clean` line matters: the official `python:3.12-slim` base image ships a config that auto-deletes apt archives after install, which defeats the cache mount. You have to remove that file first.

**Impact:** Cold build still pays the full ~250s. The *next* build, even with requirements changes, drops to **~30–60s** because most wheels and .debs are already on disk in the cache volume.

**Measured on AIAAS, May 2026:**

```
Cold build (builder cache wiped first, populating apt + pip caches): 1408s
Warm rebuild immediately after, source unchanged:                       9s
```

That's a **156× speedup** — though the 9s number is the unrealistically-best case where BuildKit sees every layer hash matches and emits the existing manifest with no real work. The realistic everyday number is the third scenario: edit `requirements-linux.txt` (which invalidates the pip layer but the wheel cache is reused) → roughly **30–60s** instead of the cold 250s.

Why the cold number (1408s) is much higher than the baseline (~600s) noted earlier in this doc: this measurement explicitly wiped the BuildKit cache *and* the pulled-image cache with `docker builder prune -af` before timing, forcing a fresh download of every layer including the `python:3.12-slim` base, plus the full pip install with no wheels cached. A "normal" cold build that still has the base image cached comes in at ~600s.

### Fix #2 — Compress the docker-save tarball before scp

```bash
# Instead of: docker save image -o file.tar
docker save kaushaljainai/aiaas-backend:latest | gzip -1 > image.tar.gz
# 2.4 GB → ~1.5 GB

scp -i my-key.pem image.tar.gz ec2-user@host:/home/ec2-user/
ssh ec2-user@host 'gunzip -c /home/ec2-user/image.tar.gz | sudo docker load'
```

Notes:
- `gzip -1` (fast mode) uses ~1 CPU core; the bottleneck is upstream bandwidth, not CPU
- **Don't combine with `scp -C`** — scp's compression of already-gzipped data is wasted CPU and can be slower
- `docker save | ssh ... 'docker load'` (no intermediate file) also works but doesn't survive a network blip mid-transfer

**Impact:** ~35% reduction in transfer size. With slow upstream, the deploy goes from ~30 min to ~20 min.

### Fix #3 — Patch-layer trick when only application code changed

When the change is small (a single file edit), **don't re-ship the whole image**. Build a tiny patch layer **on the destination host**:

```bash
# Locally: scp just the changed file
scp -i my-key.pem Backend/inference/apps.py ec2-user@host:/tmp/patch/apps.py

# On EC2: Dockerfile is two lines
cat > /tmp/patch/Dockerfile <<'EOF'
FROM kaushaljainai/aiaas-backend:latest
COPY apps.py /app/inference/apps.py
EOF

# Build on EC2 (instant — the base image already exists locally)
sudo docker build -t kaushaljainai/aiaas-backend:latest /tmp/patch
sudo docker-compose up -d --force-recreate backend
```

**Impact:** Going from a hotfix idea to a running container in **~30 seconds** instead of 30 minutes. We used this to ship the `PRELOAD_EMBEDDER=False` gate when the full image scp had been stuck for over an hour.

### Fix #4 — Switch pip to `uv`

[uv](https://github.com/astral-sh/uv) is a Rust-based pip replacement. For our 200-package install:

```dockerfile
RUN --mount=type=cache,target=/root/.cache/uv,sharing=locked \
    pip install --upgrade pip uv \
    && uv pip install --system --index-url https://download.pytorch.org/whl/cpu torch==2.11.0 \
    && uv pip install --system -r requirements-linux.txt
```

`uv` parallelizes downloads and dependency resolution. On a *cold* build (no cache), expect pip's ~250s → uv's ~30–60s. With the cache mount as well, incremental builds are nearly instant.

**Impact:** 3–5× faster cold installs. Combined with Fix #1 it makes incremental builds essentially free.

### Fix #5 — The structural fix: drop the ML stack

The vast majority of our build pain is one feature: the local Qwen3 embedder in `inference/engine.py`. It pulls torch (~250 MB), transformers, tokenizers, safetensors, huggingface_hub, scipy, scikit-learn — collectively **~4 GB of installed bytes**, ~150s of the pip install time, and the single 5 GB image layer that broke Docker Hub pushes.

Replace it with hosted embeddings (Google `text-embedding-004` via the already-installed `langchain-google-genai`):

| Metric | With local embedder | With hosted embeddings |
|---|---|---|
| Cold pip install time | ~250s | ~30s |
| Image size | 7.2 GB | **~1.5 GB** |
| Saved tarball (gzipped) | ~1.5 GB | **~250 MB** |
| Docker Hub push | fails on vpnkit | succeeds in ~2 min |
| EC2 SCP at 1 Mbps | ~30 min | **~3 min** |
| EC2 RAM headroom | crashes (OOM) | fits in t3.medium |

Tradeoff: an API call per embedding instead of local inference. For a small KB at typical query volumes, this is cheaper than paying for a bigger EC2 instance.

### Fix #6 — Pre-baked dependencies image

Push a `kaushaljainai/aiaas-deps:python3.12-2026-05` image **once** (just apt + pip layers, no app code). Then your everyday Dockerfile becomes:

```dockerfile
FROM kaushaljainai/aiaas-deps:python3.12-2026-05
COPY . /app
CMD [...]
```

Daily builds:
- Build time: ~10–20s
- Push: ~5 MB (just app code layer)

Only rebuild the deps image when `requirements-linux.txt` changes (every few weeks). One extra Docker Hub repo, big payoff. Best combined with Fix #5 so the deps image stays under 1 GB.

---

## Reclaiming disk space

Docker on Windows tends to grow without bound across builds. After a few weeks of iteration, the AIAAS machine had ~30 GB of build-cache and orphan images. `docker system df -v` is the inventory you want:

```bash
docker system df -v
```

The columns to focus on are **UNIQUE SIZE** (per image) and the **Build cache** total at the bottom. Layer sharing means the same image's `SIZE` column lies — what gets freed when you delete a tag is only its `UNIQUE SIZE`.

### Tiered cleanup, from safe to nuclear

```bash
# 1. Drop containers that exited long ago (always safe — they aren't running)
docker container prune -f

# 2. Drop dangling images (the <none>:<none> ones from older builds — always safe)
docker image prune -f

# 3. Drop a specific tagged image you know you don't need (e.g. test tags)
docker rmi kaushaljainai/aiaas-backend:cache-cold kaushaljainai/aiaas-backend:cache-warm

# 4. Drop ALL unused images (anything not tied to a running container)
#    Riskier: re-pulling them costs bandwidth + time.
docker image prune -a -f

# 5. Drop the build cache (BuildKit's intermediate layers + cache mounts)
#    This is the biggest single reclaim. Downside: next build is cold again,
#    so you're trading disk space for a slow rebuild.
docker builder prune -af

# 6. Nuclear: everything not actively in use, including volumes (destroys data!)
docker system prune -a --volumes
```

### Don't prune the build cache right after priming it

If you just did Fix #1 (cache mounts), running `docker builder prune` immediately undoes the benefit. The `exec.cachemount` entries in `docker system df -v` are your apt and pip wheel caches — those are what make warm rebuilds fast. Specifically:

```
mermeoy43agc   exec.cachemount   188MB    (apt cache — .debs)
k3327l0je274   exec.cachemount   472MB    (pip wheel cache)
```

Keep these. If you must reclaim cache, prune everything *except* cache mounts:

```bash
docker builder prune -f                              # prunes inline cache only, NOT --mount=type=cache
# Or, if you really want everything gone:
docker builder prune --filter type=exec.cachemount   # would target ONLY the cache mounts (rarely what you want)
```

### Across all projects, not just this one

Docker doesn't have project scoping — `docker system df` shows everything. To find orphans from old projects (like `ngu-frontend` left over from the spice-trading work):

```bash
docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}' \
  | sort
```

Anything you don't recognize and that's not running is fair game for `docker rmi`. Use `docker ps -a | grep <image>` first to confirm no container references it.

### Reclaiming WSL disk specifically

On Windows, Docker Desktop's actual storage lives inside the `docker-desktop-data` WSL distro (now at `K:\Docker\wsl\disk` on this machine — see [learning/11](./11_docker_wsl_storage_relocation.md)). Running `docker image prune` *inside* Docker frees layers, but **WSL's VHDX doesn't shrink** until you compact it:

```powershell
wsl --shutdown
diskpart
# In diskpart prompt:
#   select vdisk file="K:\Docker\wsl\disk\docker_data.vhdx"
#   compact vdisk
#   exit
```

Or simpler with sparse VHDX (WSL ≥ 0.58):

```ini
# %USERPROFILE%\.wslconfig
[experimental]
sparseVhd=true
```

Sparse VHDX shrinks automatically as you delete data. Set once, forget. See [learning/11](./11_docker_wsl_storage_relocation.md) for the full WSL storage story.

---

## What about `.dockerignore`?

A loose `.dockerignore` was costing us **2.49 GB** of build context (mostly `static/`, `media/`, `venv/`). Tightening it dropped context to **187 KB**. The context transfer happens before any layer, so this is a flat win across every build.

Anti-pattern we hit: my first tightened `.dockerignore` excluded `logs/`, which is actually a **Django app**, not a log-file directory. The container crash-looped on `ModuleNotFoundError: No module named 'logs'`. Lesson: **don't blindly exclude directories that share names with conventional concepts** — verify each is what you think it is.

---

## What about `--push` / buildx multi-stage?

`docker buildx build --push` is generally better than `build` + `push` because:
- It can push layers as they build, parallelizing the long upload
- Cache-from / cache-to can use remote registries directly

But on our slow upstream over Docker Desktop's vpnkit, the same multi-GB layer kept failing whether we used `push` or `buildx ... --push`. The vpnkit issue is in Docker Desktop's network stack, not in the registry client. If you're on Linux or macOS (no vpnkit), `--push` is the right default.

---

## Practical recipe for our AIAAS backend

1. Keep the Dockerfile cache mounts (Fix #1).
2. Always `docker save | gzip -1 | scp` for deploys (Fix #2).
3. Use the patch-layer trick (Fix #3) for any change that doesn't require new Python deps.
4. Plan the Tier 2 refactor (Fix #5) — that's the structural unblock.
5. Reconsider `uv` (Fix #4) and the deps base image (Fix #6) only after #5.

---

## Interview Questions

1. **What's the difference between `--no-cache-dir` for pip in a single-stage vs multi-stage Dockerfile?**
   In a single-stage build, the pip wheel cache ends up in the final image, bloating it — so `--no-cache-dir` makes sense. In a multi-stage build, the builder stage (where pip ran) is discarded and only the site-packages directory is copied to runtime; the cache never makes it into the final image regardless. `--no-cache-dir` then only hurts — it forces every rebuild to re-download instead of reusing the cached wheels.

2. **Why does `RUN --mount=type=cache,target=/root/.cache/pip` not bloat the final image?**
   BuildKit cache mounts are stored *outside* the image — they're persistent host-side volumes that Docker mounts into the build container only during that `RUN` step. They never become part of any layer.

3. **You enabled a BuildKit pip cache mount but the cache isn't being reused. What could be wrong?**
   Most common: the official `python:slim` images include `/etc/apt/apt.conf.d/docker-clean`, which auto-purges archive caches and defeats the apt cache mount. The pip equivalent: `PIP_NO_CACHE_DIR=1` set as an env var elsewhere in the Dockerfile. Also check that you're using `# syntax=docker/dockerfile:1.x` at the top of the Dockerfile — older syntax versions don't support cache mounts.

4. **What's the order of operations when a Docker Hub push fails on a single large blob, and what are your options?**
   The push retries the failing blob (other layers are deduped on retry as "Layer already exists"), but the same blob keeps failing if the underlying network issue persists. Options: (a) restart Docker Desktop to reset vpnkit, (b) use `regctl image copy` which has different retry semantics, (c) bypass the registry entirely with `docker save | scp | docker load` — single TCP stream is easier than vpnkit's chunked HTTP, (d) shrink the layer by splitting the giant `RUN pip install` into smaller `RUN`s (each becomes its own blob).

5. **The patch-layer trick (`FROM existing-image / COPY changed-file`) — why is it so much faster?**
   You're building on top of an image the EC2 host already has, locally. No registry round-trip. No SCP of 2 GB. The only network traffic is the single changed file (1 KB). The downside: it diverges your "deployed image" from what's on Docker Hub — that's fine for a hotfix, but you should eventually rebuild and push the canonical image so the next clean redeploy works.

6. **Why did dropping torch+transformers from the image save *more* than the size of those packages?**
   Two compounding effects: (1) torch on PyPI pulls in NVIDIA CUDA libraries (~5 GB) unless you explicitly use the CPU-only index — even with CPU torch, you still get ~200 MB of torch + its deps; (2) more importantly, the *layer* containing the pip install is the single biggest blob in the image, and Docker Hub's vpnkit-via-Docker-Desktop kept failing on it. Removing those packages collapses the entire pip-install layer to a fraction of its size, which is what makes deploys finally complete.
