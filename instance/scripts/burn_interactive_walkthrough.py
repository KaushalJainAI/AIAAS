"""
burn_interactive_walkthrough.py — Renders the interactive product walkthrough
with burned-in subtitles, 1.0X natural speed for all interactions, and 4X accelerated loading.
"""

import os
import sys
import json
import subprocess
import glob

INSTANCE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORY_DIR = os.path.join(INSTANCE_DIR, "recordings", "story")
TIMESTAMPS_FILE = os.path.join(STORY_DIR, "interactive_story_timestamps.json")
FINAL_OUTPUT = os.path.join(STORY_DIR, "AIAAS_Interactive_Showcase_Subtitled.mp4")

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
    header = """[Script Info]
Title: AIAAS Interactive Showcase
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

    webm_files = sorted(glob.glob(os.path.join(STORY_DIR, "*.webm")), key=os.path.getmtime, reverse=True)
    if not webm_files:
        print("No raw video files found.")
        sys.exit(1)

    raw_video = webm_files[0]
    print(f"Using raw video: {raw_video}")

    scenes = meta.get("scenes", [])
    loading_spans = meta.get("loadingSpans", [])
    total_duration = meta.get("totalDuration", 0)

    intervals = []
    curr = 0.0
    for span in loading_spans:
        s, e = span["start"], span["end"]
        if s > curr:
            intervals.append((curr, s, 1.0))
        if e > s:
            intervals.append((s, e, 4.0)) # 4x speed for loading
        curr = e

    if curr < total_duration:
        intervals.append((curr, total_duration, 1.0))

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

    for sc in scenes:
        sc["new_start"] = map_time(sc["start"])
        sc["new_end"] = map_time(sc.get("end", sc["start"] + 6.0))

    print(f"Raw duration: {total_duration:.2f}s -> Polished duration: {map_time(total_duration):.2f}s")

    chunk_files = []
    for idx, (st, en, spd) in enumerate(intervals):
        if en <= st: continue
        chunk_name = os.path.join(STORY_DIR, f"ichunk_{idx:02d}.mp4")
        pts = f"setpts={(1.0 / spd):.4f}*PTS"
        run([
            "ffmpeg", "-y", "-ss", f"{st:.3f}", "-to", f"{en:.3f}",
            "-i", raw_video,
            "-vf", pts,
            "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p",
            chunk_name
        ])
        chunk_files.append(chunk_name)

    chunk_list_txt = os.path.join(STORY_DIR, "ichunk_list.txt")
    with open(chunk_list_txt, "w") as f:
        for c in chunk_files:
            f.write(f"file '{c}'\n")

    unsubbed_video = os.path.join(STORY_DIR, "unsubbed_interactive.mp4")
    run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", chunk_list_txt, "-c", "copy",
        unsubbed_video
    ])

    ass_path = os.path.join(STORY_DIR, "interactive_walkthrough.ass")
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

    for f in [chunk_list_txt, unsubbed_video] + chunk_files:
        if os.path.exists(f):
            try: os.remove(f)
            except: pass

    print("\n" + "="*60)
    print("SUCCESS: Interactive Subtitled Walkthrough Created!")
    print(f"File: {FINAL_OUTPUT}")
    print("="*60 + "\n")

if __name__ == "__main__":
    main()
