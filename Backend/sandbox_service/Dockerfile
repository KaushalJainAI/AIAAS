# The sandbox sidecar image. It runs untrusted, LLM-authored Python and
# JavaScript, and a fixed list of text commands, so it is built to hold
# nothing worth stealing and to have nowhere to send it: no application code,
# no credentials, no network egress (enforced by compose).
#
# The container is the security boundary. runner.py, launch.py and
# executor.py add per-run resource limits and seccomp filters on top; see
# their docstrings.

# Only the `node` binary is taken from this image: no npm, no npx, no package
# cache. Code runs on Node's standard library (TypeScript is stripped by Node
# itself), so there is nothing to install and nothing to fetch.
FROM node:22.18.0-bookworm-slim AS node

FROM python:3.12-slim

# libgomp1 is numpy/BLAS's OpenMP runtime; without it `import numpy` fails.
# libstdc++6 is Node's C++ runtime. gawk, jq, unzip, file and bsdextrautils
# (`column`) are the parts of the `run_command` allowlist (commands.py) that
# the slim base does not already ship.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgomp1 libseccomp2 libstdc++6 \
        gawk jq unzip file bsdextrautils \
    && rm -rf /var/lib/apt/lists/*

COPY --from=node /usr/local/bin/node /usr/local/bin/node

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY runner.py launch.py commands.py executor.py server.py ./

# Fail the build, not a run, if a command on the allowlist is missing from
# the image, or if Node cannot start.
RUN python -c "import commands, os, sys; missing = [n for n, c in commands.COMMANDS.items() if not os.access(c.path, os.X_OK)]; sys.exit('allowlisted but not installed: ' + ', '.join(missing) if missing else 0)" \
    && node --version

# A non-root user with no home and no shell. Combined with compose's
# `read_only: true` + a small tmpfs on /tmp, the process can write only to
# scratch space that vanishes with the container.
RUN useradd --no-create-home --shell /usr/sbin/nologin sandbox
USER sandbox

ENV SANDBOX_HOST=0.0.0.0 \
    SANDBOX_PORT=8100 \
    PYTHONUNBUFFERED=1

EXPOSE 8100

# A liveness probe that does not need curl in the image.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8100/health', timeout=3).status==200 else 1)"

CMD ["python", "server.py"]
