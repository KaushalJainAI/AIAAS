# 11 — Docker Desktop WSL2 Storage Relocation (C: → K:)

What happens when Docker Desktop's WSL2 virtual disks fill up the C: drive, and how to relocate them safely without losing images, containers, or volumes.

---

## The Problem

Docker Desktop on Windows runs the daemon inside WSL2. It registers **two distros**:

| Distro | What it holds | Typical size |
|---|---|---|
| `docker-desktop` | The Linux kernel + dockerd engine binaries | ~1 GB |
| `docker-desktop-data` | All images, containers, volumes, build cache | tens of GB and growing |

Both default to `%LOCALAPPDATA%\Docker\wsl\...` on the C: drive. On a machine with a small system SSD this becomes the #1 storage hog and eventually causes:

- `docker pull` failing with `no space left on device`
- Docker Desktop refusing to start
- WSL errors like `wsl/Service/CreateInstance/MountVhd/HCS/0x80070032`

The "obvious" fix — copy `wsl\` to another drive and delete the original — **breaks Docker**, because WSL's distro registry still points at the old VHDX paths. The correct fix is to **re-register the distros** at the new location.

---

## What Actually Happened on This Machine

Initial WSL state when Docker would not start:

```
DistributionName    BasePath
----------------    --------
docker-desktop-data K:\Docker\wsl\disk  already on K:
docker-desktop  \\?\C:\Users\91700\AppData\Local\Docker\wsl\main  folder did not exist
```

So `docker-desktop-data` (58 GB of images/volumes) had been moved correctly at some earlier point, but the small **engine** distro was registered to a C: path whose files had been deleted. Docker Desktop refused to start because it couldn't mount the engine VHDX.

Key insight: **`docker-desktop` carries no user data**. Unregistering and re-importing it from Docker Desktop's shipped bootstrap tar is non-destructive — all images, containers, volumes live inside `docker-desktop-data`.

---

## The Fix (PowerShell, Admin not required)

### 1. Inspect current state

```powershell
wsl --list --verbose
Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss\*" |
  Where-Object { $_.DistributionName -like 'docker*' } |
  Select-Object DistributionName, BasePath
```

The registry under `HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss\*` is WSL's authoritative source of truth for distro locations. `BasePath` tells you exactly where each VHDX lives.

### 2. Quit Docker and shut down WSL

```powershell
Get-Process "Docker Desktop","com.docker.backend","com.docker.build" -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue
wsl --shutdown
```

WSL must be fully shut down or `--unregister`/`--import` will hold-lock.

### 3. Unregister the broken engine distro

```powershell
wsl --unregister docker-desktop
```

Safe because:
- The files were already missing (nothing to lose)
- Even with intact files, `docker-desktop` is just the engine — user data lives in `docker-desktop-data`

### 4. Re-import using Docker Desktop's shipped bootstrap tar

```powershell
New-Item -ItemType Directory -Path "K:\Docker\wsl\main" -Force | Out-Null
wsl --import docker-desktop "K:\Docker\wsl\main" `
    "C:\Program Files\Docker\Docker\resources\wsl\wsl-data.tar" `
    --version 2
```

Docker Desktop ships `wsl-data.tar` (~5 MB) precisely for this rebootstrap case. The third argument to `wsl --import` is the **source tar**; the second is the **destination directory** for the new VHDX.

### 5. Verify and launch

```powershell
Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss\*" |
  Where-Object { $_.DistributionName -like 'docker*' } |
  Select-Object DistributionName, BasePath

Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
```

Expected after fix:

```
DistributionName    BasePath
----------------    --------
docker-desktop-data K:\Docker\wsl\disk
docker-desktop      K:\Docker\wsl\main
```

### 6. Confirm the daemon is healthy

```powershell
docker info
docker images
docker volume ls
docker run --rm hello-world
```

Old images and volumes are still there because `docker-desktop-data` was never touched.

---

## Moving Both Distros from Scratch (the general recipe)

If both distros are still on C: and intact, the canonical relocation sequence is:

```powershell
# 1. Quit Docker, shut down WSL
wsl --shutdown

# 2. Export both distros to portable tars
New-Item -ItemType Directory -Path "K:\Docker\backup" -Force | Out-Null
wsl --export docker-desktop      "K:\Docker\backup\docker-desktop.tar"
wsl --export docker-desktop-data "K:\Docker\backup\docker-desktop-data.tar"

# 3. Unregister (this deletes the C: VHDX files)
wsl --unregister docker-desktop
wsl --unregister docker-desktop-data

# 4. Re-import at K:
wsl --import docker-desktop      "K:\Docker\wsl\main" "K:\Docker\backup\docker-desktop.tar"      --version 2
wsl --import docker-desktop-data "K:\Docker\wsl\disk" "K:\Docker\backup\docker-desktop-data.tar" --version 2
```

Then in Docker Desktop → **Settings → Resources → Advanced → Disk image location** point it at `K:\Docker\wsl\disk` so future growth stays on K:.

> Order matters: `wsl --export` first, *then* `--unregister`. Once unregistered without a backup, the data is gone.

---

## Why Not Just Copy the VHDX?

Two reasons:

1. **WSL caches the BasePath in the Lxss registry hive.** Copying the file does not update that entry, so WSL still tries to mount the original path.
2. **VHDX files are sparse and held open by the vmcompute service.** A naïve copy while WSL is running yields a corrupt destination. `wsl --export` produces a consistent, portable tar.

---

## Preventing Recurrence — `.wslconfig` (optional)

You can cap the memory and disk WSL claims, but you **cannot** set the per-distro storage location via `.wslconfig` — that's only set at distro registration time. Useful guardrails go in `%USERPROFILE%\.wslconfig`:

```ini
[wsl2]
memory=8GB
processors=4
swap=2GB
# Cap how large the dynamic VHDX can grow before WSL refuses more writes
# Requires WSL >= 0.58
[experimental]
sparseVhd=true
```

Sparse VHDX (`sparseVhd=true`) is the real fix for the "VHDX never shrinks after `docker system prune`" problem.

---

## CI/CD Impact

None of this affects the project's docker-compose pipeline. `docker-compose.yml` and `docker-compose.prod.yml` reference services and named volumes — the daemon decides where those volumes physically live. Once the daemon is healthy, the pipeline is unchanged:

```bash
docker compose up --build                # local dev
docker compose --profile async up        # with Celery worker
docker compose -f docker-compose.prod.yml up -d  # EC2
```

See [DEPLOYMENT.md](../DEPLOYMENT.md) for the full pipeline.

---

## Interview Questions

1. **What's the difference between `docker-desktop` and `docker-desktop-data` distros?**
   Engine vs. user data. Engine is the WSL2 distro running dockerd; data holds all images, containers, and volumes. Knowing this means you can safely rebuild the engine without losing anything.

2. **Why can't you just move a WSL VHDX file to another drive?**
   WSL stores BasePath in the Lxss registry. Without updating the registry — which `wsl --import` does for you — WSL still tries to mount the original location. Also, copying a live VHDX held by the vmcompute service produces corruption.

3. **You're out of space on C: but Docker has a 60 GB image cache. What do you do?**
   Either prune (`docker system prune -a --volumes`) if disposable, or relocate `docker-desktop-data` to another drive via `wsl --export` → `--unregister` → `--import`. Then point Docker Desktop's "Disk image location" at the new path so future pulls land there.

4. **What's special about `docker run --rm hello-world` as a smoke test?**
   It exercises image pull (registry auth + network), container create (engine), and a one-shot run (cgroups + namespaces). If it passes, the daemon, network, and storage layer are all healthy. `--rm` avoids leaving an artifact behind.

5. **Why does the project's compose file not need changes after this relocation?**
   Compose declares *named volumes* (`backend_data`, `redis_data`), not host paths. The daemon resolves where named volumes physically live. Moving the daemon's storage backend is transparent to compose.
