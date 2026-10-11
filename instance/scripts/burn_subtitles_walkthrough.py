"""
burn_subtitles_walkthrough.py — Master in-depth product walkthrough with:
1. NO 2X speed gimmick (plays at natural, watchable 1.0X speed throughout).
2. Compressed loading screen times (accelerated 4X so no dead spinner waits).
3. Professional on-screen subtitles explaining each page and feature in depth.
4. Crystal clear 1080p H.264 output optimized for presentations and marketing.
"""

import os
import sys
import json
import subprocess
import glob

INSTANCE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORY_DIR = os.path.join(INSTANCE_DIR, "recordings", "story")
TIMESTAMPS_FILE = os.path.join(STORY_DIR, "deep_story_timestamps.json")
FINAL_OUTPUT = os.path.join(STORY_DIR, "AIAAS_Master_Showcase_Subtitled.mp4")

def run(cmd):
    print("Executing:", " ".join(cmd[:8]), "...")
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        print("FFmpeg error:", res.stderr)
        raise RuntimeError(f"Command failed with code {res.returncode}")
    return res

def format_ass_time(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int((seconds - int(seconds)) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"

def generate_ass(scenes, output_ass_path):
    # Modern, crisp subtitle overlay with clean typography and dark pill background
    header = """[Script Info]
Title: AIAAS Product Walkthrough
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: None
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Banner,Segoe UI,32,&H00FFFFFF,&H000000FF,&H00000000,&HA00D1117,-1,0,0,0,100,100,0,0,3,12,0,2,80,80,45,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [header]
    for s in scenes:
        st = format_ass_time(s["new_start"])
        et = format_ass_time(s["new_end"])
        title = s["title"].upper()
        subtitle = s["subtitle"]
        # Gold/Cyan header with crisp white explanation
        text = rf"{{\b1\c&H00D4FF&}}{title}{{\b0}}\N{{\c&HEAEAEA&\fs24}}{subtitle}"
        lines.append(f"Dialogue: 0,{st},{et},Banner,,0,0,0,,{text}\n")

    with open(output_ass_path, "w", encoding="utf-8") as f:
        f.writelines(lines)
    print(f"Generated ASS subtitle file: {output_ass_path}")

def main():
    if not os.path.exists(TIMESTAMPS_FILE):
        print(f"Timestamp file missing: {TIMESTAMPS_FILE}")
        sys.exit(1)

    with open(TIMESTAMPS_FILE, "r") as f:
        meta = json.load(f)

    # Find the newest webm file
    webm_files = sorted(glob.glob(os.path.join(STORY_DIR, "*.webm")), key=os.path.getmtime, reverse=True)
    if not webm_files:
        print("No raw video files found.")
        sys.exit(1)

    raw_video = webm_files[0]
    print(f"Using raw video: {raw_video}")

    scenes = meta.get("scenes", [])
    loading_spans = meta.get("loadingSpans", [])
    total_duration = meta.get("totalDuration", 0)

    # Intervals:
    # Everything runs at 1.0X normal watchable speed.
    # ONLY loading spans (empty network spinners) are accelerated to 4.0X.
    intervals = []
    curr = 0.0
    for span in loading_spans:
        s, e = span["start"], span["end"]
        if s > curr:
            intervals.append((curr, s, 1.0))
        if e > s:
            intervals.append((s, e, 4.0)) # 4x speed loading
        curr = e

    if curr < total_duration:
        intervals.append((curr, total_duration, 1.0))

    # Map original timestamps to edited timeline
    def map_time(orig_t):
        new_t = 0.0
        for st, en, spd in intervals:
            if orig_t <= st:
                break
            elif orig_t <= en:
                new_t += (orig_t - st) / spd
                break
            else:
                new_t += (en - st) / spd
        return new_t

    # Update scene timings for the subtitles
    for sc in scenes:
        sc["new_start"] = map_time(sc["start"])
        sc["new_end"] = map_time(sc.get("end", sc["start"] + 6.0))

    print(f"Total raw duration: {total_duration:.2f}s -> Polished duration: {map_time(total_duration):.2f}s")

    # Render segments
    chunk_files = []
    for idx, (st, en, spd) in enumerate(intervals):
        if en <= st: continue
        chunk_name = os.path.join(STORY_DIR, f"mchunk_{idx:02d}.mp4")
        pts = f"setpts={(1.0 / spd):.4f}*PTS"
        run([
            "ffmpeg", "-y", "-ss", f"{st:.3f}", "-to", f"{en:.3f}",
            "-i", raw_video,
            "-vf", pts,
            "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p",
            chunk_name
        ])
        chunk_files.append(chunk_name)

    chunk_list_txt = os.path.join(STORY_DIR, "mchunk_list.txt")
    with open(chunk_list_txt, "w") as f:
        for c in chunk_files:
            f.write(f"file '{c}'\n")

    unsubbed_video = os.path.join(STORY_DIR, "unsubbed_master.mp4")
    run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", chunk_list_txt, "-c", "copy",
        unsubbed_video
    ])

    # Burn stylized subtitles
    ass_path = os.path.join(STORY_DIR, "master_walkthrough.ass")
    generate_ass(scenes, ass_path)

    escaped_ass = ass_path.replace("\\", "/").replace(":", "\\:")

    print("Burning subtitles onto 1080p master video...")
    run([
        "ffmpeg", "-y",
        "-i", unsubbed_video,
        "-vf", f"ass='{escaped_ass}'",
        "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        FINAL_OUTPUT
    ])

    # Clean intermediate chunk files
    for f in [chunk_list_txt, unsubbed_video] + chunk_files:
        if os.path.exists(f):
            try: os.remove(f)
            except: pass

    print("\n" + "="*60)
    print("SUCCESS: In-Depth Subtitled Showcase Video Created!")
    print(f"File: {FINAL_OUTPUT}")
    print("="*60 + "\n")

if __name__ == "__main__":
    main()
