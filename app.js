import 'dotenv/config'
import express from "express";
import { exec, spawn } from "child_process";
import fs from "fs";
import NodeMediaServer from "node-media-server";
const MEDIA_ROOT = "./media";

if (!fs.existsSync(MEDIA_ROOT)) {
  fs.mkdirSync(MEDIA_ROOT, { recursive: true });
  console.log(
    `📂 สร้างโฟลเดอร์ media root ที่: ${MEDIA_ROOT} (แต่ HLS ถูกปิดใช้งาน)`
  );
}

const app = express();

app.use(express.json());

const activeStreams = new Map();

const config = {
  logType: 4,
  rtmp: {
    host: "0.0.0.0",
    port: process.env.RTMP_PORT,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60,
  },
  http: {
    host: "0.0.0.0",
    port: process.env.HTTP_PORT,
    mediaroot: MEDIA_ROOT,
    allow_origin: "*",
  },
  trans: {
    ffmpeg: "ffmpeg",
    tasks: [
      {
        app: "live",
        hls: false,
        vc: "libx264",
        ac: "aac",
        hlsFlags: "[hls_time=2:hls_list_size=3:hls_flags=delete_segments]",
      },
    ],
  },
};

const nms = new NodeMediaServer(config);

nms.run();

app.get("/api/status", (req, res) => {
  res.json({
    message: "Node Media Server is running (RTMP/HTTP-FLV only)",
    rtmp_port: config.rtmp.port,
    http_port: config.http.port,
  });
});

app.post("/api/start-stream", (req, res) => {
  const { rtspUrl, streamKey } = req.body;

  if (!rtspUrl)
    return res.status(400).json({ error: "Missing rtspUrl in request body" });

  const key = streamKey || "stream";
  const rtmpUrl = `rtmp://127.0.0.1:8080/live/${key}`;

  if (activeStreams.has(key)) {
    return res.status(400).json({
      error: `Stream ${key} is already running. Please stop it first.`,
    });
  }

  const args = [
    // **ใช้ -re เพื่อปรับอัตราการอ่าน input ให้เป็นแบบเรียลไทม์**
    "-re",
    "-rtsp_transport",
    "tcp",
    "-i",
    rtspUrl,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-f",
    "flv",
    rtmpUrl,
  ];
  const ffmpegProcess = spawn("ffmpeg", args);
  activeStreams.set(key, ffmpegProcess);
  ffmpegProcess.stdout.on("data", (data) =>
    console.log(`[FFMPEG:${key} STDOUT]: ${data.toString().trim()}`)
  );
  ffmpegProcess.stderr.on("data", (data) =>
    console.log(`[FFMPEG:${key} STDERR]: ${data.toString().trim()}`)
  );
  ffmpegProcess.on("error", (err) => {
    console.error(
      `[FFMPEG:${key} ERROR]: Failed to start or encountered an error. Check FFmpeg PATH. ${err.message}`
    );
    activeStreams.delete(key);
  });
  ffmpegProcess.on("close", (code) => {
    if (code !== 0 && code !== null) {
      console.error(
        `[FFMPEG:${key} CLOSE]: Process exited unexpectedly with code ${code}`
      );
    }
    activeStreams.delete(key);
  });
  res.json({
    message: "Restream started. NMS is relaying RTMP and serving HTTP-FLV.",
    input: rtspUrl,
    output: rtmpUrl,
    rtmp_url: `rtmp://${process.env.HOST_RTMP}:${process.env.RTMP_PORT}/live/${key}`,
    http_flv_url: `http://${process.env.HOST_HTTP}:${process.env.HTTP_PORT}/live/${key}.flv`,
  });
});

app.post("/api/stop-stream", (req, res) => {
  const { streamKey } = req.body;
  const key = streamKey || "stream";
  const process = activeStreams.get(key);
  if (process) {
    process.kill("SIGINT");
    res.json({
      message: `FFmpeg process for stream ${key} stopped gracefully.`,
    });
  } else if (!streamKey) {
    exec("pkill -f ffmpeg", () => {
      activeStreams.clear();
      res.json({
        message: "Attempted to stop all FFmpeg processes (pkill fallback).",
      });
    });
  } else {
    res.status(404).json({ error: `Stream ${key} is not currently running.` });
  }
});

app.get("/api/streams", async (req, res) => {
  const nmsApiUrl = `http://${process.env.HOST}:${config.http.port}/api/streams`;
  try {
    const response = await fetch(nmsApiUrl);
    if (response.ok) {
      const data = await response.json();
      const liveStreams = data.live || {};
      const streamKeys = Object.keys(liveStreams).filter(
        (key) => liveStreams[key].publisher
      );
      return res.json({
        message: "Active streams retrieved from NMS HTTP API.",
        active_streams: streamKeys,
      });
    }
    throw new Error(`NMS HTTP API returned status: ${response.status}`);
  } catch (e) {
    console.error(
      `[ERROR] Failed to fetch NMS stats via HTTP API: ${e.message}. Falling back to internal map.`
    );
    return res.json({
      message: "Active streams (Fallback from Express internal map)",

      active_streams: Array.from(activeStreams.keys()),
    });
  }
});

const PORT = process.env.API_PORT;

app.listen(PORT, () => {
  console.log(`✅ API Server running on http://${process.env.HOST}:${PORT}`);
  console.log(`🔗 HTTP-FLV Player: http://${process.env.HOST}:${PORT}/`);
  console.log(`📡 RTMP Output: rtmp://${process.env.HOST_RTMP}:${process.env.RTMP_PORT}/live/stream`);
  console.log(`🌐 HTTP-FLV Output: http://${process.env.HOST_HTTP}:${process.env.HTTP_PORT}/live/stream.flv`);
  console.log("--- HTTP-FLV Streaming Active (No Files) ---");
  console.log(
    "*** โปรดใช้ flv.js player หรือโปรแกรมภายนอกที่รองรับ FLV เพื่อดูสตรีม HTTP-FLV ***"
  );
});
