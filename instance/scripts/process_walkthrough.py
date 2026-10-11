"""
process_walkthrough.py — Advanced post-processing for AIAAS story walkthrough.
Generates:
1. AIAAS_Story_Showcase.mp4 — Feature-paced walkthrough with loading screens accelerated 4X and finale at 2X.
2. AIAAS_Story_FastCut.mp4 — Decimated rapid cut (~22s) ideal for social media / quick demos.
"""

import os
import sys
import json
import subprocess
import glob

INSTANCE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORY_DIR = os.path.join(INSTANCE_DIR, "recordings", "story")
TIMESTAMPS_FILE = os.path.join(STORY_DIR, "story_timestamps.json")
OUTPUT_SHOWCASE = os.path.join(STORY_DIR, "AIAAS_Story_Showcase.mp4")
OUTPUT_FASTCUT = os.path.join(STORY_DIR, "AIAAS_Story_FastCut.mp4")

def run(cmd):
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        print("FFmpeg error:", res.stderr)
        raise RuntimeError(f"Command failed with code {res.returncode}")
    return res

def main():
    if not os.path.exists(TIMESTAMPS_FILE):
        print(f"Timestamps file not found: {TIMESTAMPS_FILE}")
        sys.exit(1)

    with open(TIMESTAMPS_FILE, "r") as f:
        meta = json.load(f)

    webm_files = sorted(glob.glob(os.path.join(STORY_DIR, "*.webm")), key=os.path.getmtime, reverse=True)
    if not webm_files:
        print(f"No webm recordings found in {STORY_DIR}")
        sys.exit(1)

    raw_video = webm_files[0]
    print(f"Raw video: {raw_video}")

    finale_start = meta.get("finaleStart", 61.75)
    loading_spans = meta.get("loadingSpans", [])
    total_duration = meta.get("totalDuration", 69.86)

    # ---------------------------------------------------------
    # 1. GENERATE FAST CUT (Frame-decimated + 2X finale)
    # ---------------------------------------------------------
    print("Generating AIAAS_Story_FastCut.mp4...")
    part1_tmp = os.path.join(STORY_DIR, "tmp_p1.mp4")
    part2_tmp = os.path.join(STORY_DIR, "tmp_p2.mp4")
    concat_txt = os.path.join(STORY_DIR, "tmp_concat.txt")

    run([
        "ffmpeg", "-y", "-ss", "0", "-to", str(finale_start),
        "-i", raw_video,
        "-vf", "mpdecimate=hi=64*12:lo=64*5:frac=0.33,setpts=N/FRAME_RATE/TB",
        "-c:v", "libx264", "-crf", "19", "-preset", "fast", "-pix_fmt", "yuv420p",
        part1_tmp
    ])

    run([
        "ffmpeg", "-y", "-ss", str(finale_start),
        "-i", raw_video,
        "-vf", "setpts=0.5*PTS",
        "-c:v", "libx264", "-crf", "19", "-preset", "fast", "-pix_fmt", "yuv420p",
        part2_tmp
    ])

    with open(concat_txt, "w") as f:
        f.write(f"file '{part1_tmp}'\nfile '{part2_tmp}'\n")

    run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", concat_txt, "-c", "copy", "-movflags", "+faststart",
        OUTPUT_FASTCUT
    ])

    # ---------------------------------------------------------
    # 2. GENERATE FEATURE SHOWCASE (4X loading reduction + 2X finale)
    # ---------------------------------------------------------
    print("Generating AIAAS_Story_Showcase.mp4 (Feature-paced)...")
    
    # We partition [0, total_duration] into intervals:
    # Intervals inside loadingSpans get 4X speed (setpts=0.25*PTS)
    # Intervals in main body get 1X speed (setpts=1.0*PTS)
    # Finale interval [finale_start, total_duration] gets 2X speed (setpts=0.5*PTS)
    intervals = []
    curr = 0.0
    for span in loading_spans:
        s, e = span["start"], min(span["end"], finale_start)
        if s > curr:
            intervals.append((curr, s, 1.0))
        if e > s:
            intervals.append((s, e, 4.0)) # 4x speed for loading
        curr = e

    if curr < finale_start:
        intervals.append((curr, finale_start, 1.0))

    # Finale: 2X speed
    intervals.append((finale_start, total_duration, 2.0))

    chunk_files = []
    for idx, (st, en, spd) in enumerate(intervals):
        if en <= st: continue
        chunk_name = os.path.join(STORY_DIR, f"chunk_{idx:02d}.mp4")
        pts = f"setpts={(1.0 / spd):.4f}*PTS"
        run([
            "ffmpeg", "-y", "-ss", f"{st:.3f}", "-to", f"{en:.3f}",
            "-i", raw_video,
            "-vf", pts,
            "-c:v", "libx264", "-crf", "19", "-preset", "fast", "-pix_fmt", "yuv420p",
            chunk_name
        ])
        chunk_files.append(chunk_name)

    chunk_list_txt = os.path.join(STORY_DIR, "chunk_list.txt")
    with open(chunk_list_txt, "w") as f:
        for c in chunk_files:
            f.write(f"file '{c}'\n")

    run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", chunk_list_txt, "-c", "copy", "-movflags", "+faststart",
        OUTPUT_SHOWCASE
    ])

    # Clean temporary files
    for f in [part1_tmp, part2_tmp, concat_txt, chunk_list_txt] + chunk_files:
        if os.path.exists(f):
            try: os.remove(f)
            except: pass

    print("\n=======================================================")
    print(f"1. Feature Showcase (Paced + 4X Loading + 2X Finale):")
    print(f"   -> {OUTPUT_SHOWCASE}")
    print(f"2. Fast Cut (Decimated ~22s + 2X Finale):")
    print(f"   -> {OUTPUT_FASTCUT}")
    print("=======================================================\n")

if __name__ == "__main__":
    main()
