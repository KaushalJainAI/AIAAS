# Docker build time and the Docker disk on Windows

## What happened

A cold backend image build took about ten minutes. Two steps were most of it:

| Step | Time | Why |
|---|---|---|
| `pip install` (about 200 packages, including a CPU torch, transformers, scipy, faiss) | ~250 s | The largest cost |
| Image export (copying site-packages into one layer) | ~125 s | About 4 GB of files in one layer |

Several things made it worse:

- `--no-cache-dir` threw away pip's wheel cache on every build. In a multi-stage
  build the cache was never in the final image anyway, so the flag only forced
  re-downloads.
- Neither apt nor pip had a BuildKit cache mount, so every rebuild downloaded the
  same packages again.
- A loose `.dockerignore` sent 2.49 GB of build context (`static/`, `media/`, `venv/`).
- Pushing a 5 GB layer to Docker Hub failed three times in a row. Docker Desktop's
  network stack (vpnkit) could not carry the long upload. The image went to the
  server with `docker save` and `scp` instead.
- Docker's disks lived on C:, which filled up. Later, Docker would not start because
  its engine distro pointed at a folder that no longer existed. Re-registering the
  distro fixed it (see below).

## The fix

1. **Cache mounts for apt and pip.** The Dockerfile starts with
   `# syntax=docker/dockerfile:1.7` and mounts `/root/.cache/pip` and the apt caches.
   Remove `/etc/apt/apt.conf.d/docker-clean` first. The official slim image deletes
   apt archives after install, which defeats the mount. A cold build still takes
   about the same time. A rebuild after a requirements change takes 30–60 seconds
   instead of about 250.
2. **Tight `.dockerignore`.** Context dropped to 187 KB. Do not exclude `logs/` on
   name alone: it is a Django app (`Backend/logs/`), and the container crash-looped
   without it.
3. **Compressed transfer.** `docker save image | gzip -1 | scp` cuts the tarball by
   about a third.
4. **Patch layer for small hotfixes.** Copy one changed file onto the image already on
   the host with a two-line Dockerfile. This takes seconds, not a full transfer.
5. **No torch in the requirements.** The requirements files no longer list torch or
   sentence-transformers. That removed the largest layer and most of the install time.
6. **Prune with care.** Cache mounts are what make warm builds fast. Running
   `docker builder prune` right after priming them undoes the gain. Prune containers
   and dangling images freely. Prune build cache only when disk is truly short.

### Docker's disk on Windows: never copy the VHDX

Docker Desktop runs in two WSL2 distros:

| Distro | Holds | Typical size |
|---|---|---|
| `docker-desktop` | The Linux kernel + dockerd engine binaries | ~1 GB |
| `docker-desktop-data` | Images, containers, volumes, build cache | tens of GB |

Both live under `%LOCALAPPDATA%\Docker\wsl\` on C: by default. Copying those
folders to another drive breaks Docker: WSL records each distro's path in the
`Lxss` registry hive (`HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss\*`,
the `BasePath` value), and a copy made while the disk is mounted can be
corrupt. Copying the file never updates that registry, so WSL still tries to
mount the original path.

`docker-desktop` carries **no user data** — unregistering and re-importing it
is non-destructive. The engine ships a bootstrap tar
(`wsl-data.tar`) precisely so it can be recreated. The safe relocation, for
one or both distros:

```powershell
# 1. Quit Docker, break distro holds
wsl --shutdown

# 2. Export both to portable tars (never skip; unregister deletes files)
wsl --export docker-desktop      K:\Docker\backup\docker-desktop.tar
wsl --export docker-desktop-data K:\Docker\backup\docker-desktop-data.tar

# 3. Unregister (this deletes the C: VHDX)
wsl --unregister docker-desktop
wsl --unregister docker-desktop-data

# 4. Re-import at the new location
wsl --import docker-desktop      K:\Docker\wsl\main K:\Docker\backup\docker-desktop.tar      --version 2
wsl --import docker-desktop-data K:\Docker\wsl\disk K:\Docker\backup\docker-desktop-data.tar --version 2
```

Then in Docker Desktop → **Settings → Resources → Advanced → Disk image
location**, point it at `K:\Docker\wsl\disk` so future growth stays there, and
keep the exported tars until `docker run --rm hello-world` verifies the
daemon. A single broken engine distro (files missing on C:, data intact on
K:) is fixed by re-importing just `docker-desktop` from the shipped
`wsl-data.tar` — the data distro is never touched. Sparse disks
(`sparseVhd=true` in `.wslconfig`) shrink again after deletions.

## The lesson

- **Find the dominant cost before optimising.** Here it was the install and the
  export, not the code copy.
- **Cache what survives the build.** A cache that is thrown away each build is the
  same as no cache.
- **Send less.** Build context, transfer size and layer size all cost time, and each
  can fail on its own.
- **The biggest win is removing a dependency.** Dropping a large ML stack did more
  than any Dockerfile trick.
- **Copy the tool's data by the tool's own export.** Files on disk alone are not a
  backup, and the daemon will not notice a copy.

## Code

- `Backend/Dockerfile`: cache mounts, two stages, boot command
- `Backend/.dockerignore`
- `docker-compose.prod.yml`: production stack (named volumes, memory limits)
- Deploy steps: `../DEPLOYMENT.md`
