import os
import subprocess
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from mcap.reader import make_reader
from google.protobuf.message_factory import GetMessagesFromSameFileDescriptorSet
from google.protobuf.descriptor_pb2 import FileDescriptorSet

# Load variabel dari file .env
load_dotenv()

# Ambil konfigurasi dari Environment Variables (dengan fallback default jika tidak diset)
MCAP_FILE = os.getenv("MCAP_FILE", "/home/minipc/Downloads/fixed.mcap")
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "/tmp/mcap_videos")
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 8100))

app = FastAPI()

CHANNELS = {
    "lens_0": "/camera/primary/lens_0/video",
    "lens_1": "/camera/primary/lens_1/video",
    "lens_2": "/camera/secondary/lens_2/video",
    "lens_3": "/camera/secondary/lens_3/video",
    "left_hand": "/camera/left_hand/video",
    "right_hand": "/camera/right_hand/video",
}

os.makedirs(OUTPUT_DIR, exist_ok=True)

def extract_channel_to_mp4(channel_key: str) -> str:
    if channel_key not in CHANNELS:
        raise HTTPException(status_code=404, detail="Channel tidak ditemukan")
    
    # Pastikan file MCAP ada sebelum diproses
    if not os.path.exists(MCAP_FILE):
        raise HTTPException(status_code=500, detail=f"File MCAP tidak ditemukan di path: {MCAP_FILE}")
    
    topic_target = CHANNELS[channel_key]
    output_mp4 = os.path.join(OUTPUT_DIR, f"{channel_key}.mp4")

    # Jika file MP4 valid sudah ada, langsung gunakan
    if os.path.exists(output_mp4) and os.path.getsize(output_mp4) > 1000:
        return output_mp4

    print(f"[+] Memproses & Extract {topic_target} -> {output_mp4}...")

    ffmpeg_cmd = [
        'ffmpeg', '-y',
        '-i', 'pipe:0',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'ultrafast',
        '-movflags', '+faststart',
        output_mp4
    ]
    proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)

    count = 0
    with open(MCAP_FILE, "rb") as f:
        reader = make_reader(f)
        schemas = {s.id: s for s in reader.get_summary().schemas.values()}
        proto_classes = {}

        for schema, channel, message in reader.iter_messages(topics=[topic_target]):
            if channel.schema_id not in proto_classes:
                schema_obj = schemas[channel.schema_id]
                fds = FileDescriptorSet()
                fds.ParseFromString(schema_obj.data)
                messages = GetMessagesFromSameFileDescriptorSet(fds)
                proto_classes[channel.schema_id] = messages[schema_obj.name]

            msg_cls = proto_classes[channel.schema_id]
            proto_msg = msg_cls()
            proto_msg.ParseFromString(message.data)

            proc.stdin.write(proto_msg.data)
            count += 1

    proc.stdin.close()
    proc.wait()
    print(f"[✔] Selesai ekstrak {channel_key} ({count} frame)")
    return output_mp4

@app.get("/video/{channel_key}")
def stream_video(channel_key: str):
    mp4_path = extract_channel_to_mp4(channel_key)
    return FileResponse(mp4_path, media_type="video/mp4")

@app.get("/", response_class=HTMLResponse)
def index():
    if os.path.exists("index.html"):
        with open("index.html", "r") as f:
            return f.read()
    return "<h1>File index.html tidak ditemukan</h1>"

if __name__ == "__main__":
    import uvicorn
    print(f"[*] Menggunakan file MCAP: {MCAP_FILE}")
    print(f"[*] Output MP4 directory: {OUTPUT_DIR}")
    uvicorn.run(app, host=HOST, port=PORT)

