import os
import json
import tempfile
import subprocess
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import anthropic
import openai

app = FastAPI(title="ClipCraft AI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

anthropic_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
openai_client = openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"])

UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("outputs")
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)


# ─── STEP 1: Upload + Transcribe ───────────────────────────────
@app.post("/api/transcribe")
async def transcribe_video(file: UploadFile = File(...)):
    suffix = Path(file.filename).suffix or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir=UPLOAD_DIR) as tmp:
        tmp.write(await file.read())
        video_path = tmp.name

    audio_path = video_path.replace(suffix, ".mp3")
    subprocess.run([
        "ffmpeg", "-y", "-i", video_path,
        "-vn", "-acodec", "libmp3lame", "-q:a", "4",
        audio_path
    ], check=True, capture_output=True)

    with open(audio_path, "rb") as audio_file:
        transcript = openai_client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            response_format="verbose_json",
            timestamp_granularities=["segment"]
        )

    segments = []
    for seg in transcript.segments:
        segments.append({
            "start": format_time(seg.start),
            "end": format_time(seg.end),
            "start_seconds": seg.start,
            "end_seconds": seg.end,
            "text": seg.text.strip()
        })

    os.unlink(audio_path)

    return {
        "video_path": video_path,
        "duration": transcript.duration,
        "segments": segments,
        "full_text": transcript.text
    }


# ─── STEP 2: Analyze with Claude ───────────────────────────────
@app.post("/api/analyze")
async def analyze_clips(data: dict):
    segments = data["segments"]
    video_path = data.get("video_path", "")

    formatted = "\n".join(
        f"[{s['start']} - {s['end']}] {s['text']}" for s in segments
    )

    message = anthropic_client.messages.create(
        model="claude-opus-4-5",
        max_tokens=1500,
        messages=[{
            "role": "user",
            "content": f"""You are a viral short-form video editor. Analyze this transcript and find the 5 best clips for TikTok/Reels/Shorts (each under 60 seconds).

Look for: strong hooks, complete thoughts, high energy moments, actionable tips, natural start/end points.

Transcript:
{formatted}

Return ONLY a JSON array, no markdown:
[
  {{
    "id": 1,
    "title": "Short punchy title (max 6 words)",
    "startTime": "MM:SS",
    "endTime": "MM:SS",
    "start_seconds": 0.0,
    "end_seconds": 45.0,
    "duration": "45s",
    "hook": "First line that grabs attention",
    "viralScore": 92,
    "reason": "Why this will perform well (1 sentence)",
    "tags": ["#tag1", "#tag2", "#tag3"]
  }}
]"""
        }]
    )

    text = message.content[0].text
    clips = json.loads(text.replace("```json", "").replace("```", "").strip())
    for clip in clips:
        clip["video_path"] = video_path

    return {"clips": clips}


# ─── STEP 3: Export Clips ───────────────────────────────────────
@app.post("/api/export")
async def export_clip(data: dict):
    clip = data["clip"]
    burn_captions = data.get("burn_captions", True)

    video_path = clip["video_path"]
    start = clip["start_seconds"]
    end = clip["end_seconds"]
    clip_id = clip["id"]
    output_path = str(OUTPUT_DIR / f"clip_{clip_id}.mp4")

    if burn_captions:
        temp_clip = str(OUTPUT_DIR / f"temp_{clip_id}.mp4")
        subprocess.run([
            "ffmpeg", "-y",
            "-ss", str(start), "-to", str(end),
            "-i", video_path,
            "-c:v", "libx264", "-c:a", "aac",
            "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
            temp_clip
        ], check=True, capture_output=True)

        srt_path = str(OUTPUT_DIR / f"clip_{clip_id}.srt")
        generate_srt(clip, srt_path, offset=start)

        subprocess.run([
            "ffmpeg", "-y",
            "-i", temp_clip,
            "-vf", (
                f"subtitles={srt_path}:force_style='"
                "FontName=Arial,FontSize=18,Bold=1,"
                "PrimaryColour=&H00FFFFFF,"
                "OutlineColour=&H00000000,"
                "Outline=2,Alignment=2,MarginV=80'"
            ),
            "-c:a", "copy",
            output_path
        ], check=True, capture_output=True)

        os.unlink(temp_clip)
    else:
        subprocess.run([
            "ffmpeg", "-y",
            "-ss", str(start), "-to", str(end),
            "-i", video_path,
            "-c:v", "libx264", "-c:a", "aac",
            "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
            output_path
        ], check=True, capture_output=True)

    return {
        "clip_id": clip_id,
        "output_path": output_path,
        "download_url": f"/api/download/clip_{clip_id}.mp4"
    }


@app.post("/api/export-all")
async def export_all_clips(data: dict):
    clips = data["clips"]
    burn_captions = data.get("burn_captions", True)
    results = []
    for clip in clips:
        try:
            result = await export_clip({"clip": clip, "burn_captions": burn_captions})
            results.append({"success": True, **result})
        except Exception as e:
            results.append({"success": False, "clip_id": clip["id"], "error": str(e)})
    return {"results": results}


# ─── Download ──────────────────────────────────────────────────
@app.get("/api/download/{filename}")
async def download_file(filename: str):
    file_path = OUTPUT_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(file_path), media_type="video/mp4", filename=filename)


# ─── Health ────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {"status": "ok"}


# ─── Serve React Frontend (must be LAST) ───────────────────────
frontend_path = Path("frontend/dist")
if frontend_path.exists():
    app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="static")


# ─── Helpers ───────────────────────────────────────────────────
def format_time(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    return f"{m:02d}:{s:02d}"


def format_srt_time(seconds: float) -> str:
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    ms = int((s % 1) * 1000)
    return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{ms:03d}"


def generate_srt(clip: dict, srt_path: str, offset: float = 0):
    text = clip.get("hook", clip.get("title", ""))
    start = clip["start_seconds"] - offset
    end = clip["end_seconds"] - offset
    duration = end - start
    words = text.split()
    chunk_size = max(1, len(words) // max(1, int(duration / 4)))
    chunks = [words[i:i+chunk_size] for i in range(0, len(words), chunk_size)]
    with open(srt_path, "w") as f:
        for i, chunk in enumerate(chunks):
            cs = start + i * (duration / len(chunks))
            ce = start + (i + 1) * (duration / len(chunks))
            f.write(f"{i+1}\n{format_srt_time(cs)} --> {format_srt_time(ce)}\n{' '.join(chunk)}\n\n")
                    
