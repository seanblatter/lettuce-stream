const { PassThrough } = require('stream');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const ffmpegPath = require('ffmpeg-static');

const PORT = Number(process.env.PORT || 8080);
const HEARTBEAT_INTERVAL = 15000;

const server = new WebSocket.Server({ port: PORT }, () => {
    console.log(`[relay] WebSocket relay listening on :${PORT}`);
});

server.on('connection', (socket) => {
    console.log('[relay] client connected');
    socket.binaryType = 'arraybuffer';

    let ffmpegProcess = null;
    let ffmpegInput = null;
    let heartbeatTimer = null;

    socket.on('message', (message) => {
        if (typeof message === 'string') {
            handleControl(JSON.parse(message));
            return;
        }
        if (ffmpegInput) {
            ffmpegInput.write(Buffer.from(message));
        }
    });

    socket.on('close', () => {
        console.log('[relay] client disconnected');
        cleanup();
    });

    socket.on('error', (error) => {
        console.error('[relay] socket error', error);
        cleanup();
    });

    function handleControl(payload = {}) {
        if (payload.type === 'start') {
            if (ffmpegProcess) {
                return;
            }
            const ingestUrl = buildIngestUrl(payload.ingest || {});
            if (!ingestUrl) {
                socket.send(JSON.stringify({ type: 'error', error: 'INGEST_URL_MISSING' }));
                socket.close();
                return;
            }
            startFfmpeg(ingestUrl);
            return;
        }

        if (payload.type === 'stop') {
            cleanup();
            return;
        }
    }

    function startFfmpeg(ingestUrl) {
        ffmpegInput = new PassThrough();
        const args = [
            '-re',
            '-i', 'pipe:0',
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-tune', 'zerolatency',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-ar', '44100',
            '-b:a', '160k',
            '-f', 'flv',
            ingestUrl
        ];

        ffmpegProcess = spawn(ffmpegPath, args, { stdio: ['pipe', 'inherit', 'inherit'] });
        ffmpegInput.pipe(ffmpegProcess.stdin);

        ffmpegProcess.on('exit', (code, signal) => {
            console.log('[relay] ffmpeg exited', { code, signal });
            socket.send(JSON.stringify({ type: 'ffmpeg-exit', code, signal }));
            cleanup();
            socket.close();
        });

        ffmpegProcess.on('error', (error) => {
            console.error('[relay] ffmpeg error', error);
            socket.send(JSON.stringify({ type: 'error', error: error.message }));
            cleanup();
            socket.close();
        });

        socket.send(JSON.stringify({ type: 'relay-ready' }));
        heartbeatTimer = setInterval(() => socket.ping(), HEARTBEAT_INTERVAL);
    }

    function cleanup() {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        if (ffmpegInput) {
            ffmpegInput.end();
            ffmpegInput = null;
        }
        if (ffmpegProcess) {
            ffmpegProcess.kill('SIGINT');
            ffmpegProcess = null;
        }
    }
});

function buildIngestUrl(ingest) {
    if (!ingest.url) {
        return '';
    }
    if (ingest.streamKey) {
        return ingest.url.replace(/\/?$/, '/') + ingest.streamKey;
    }
    return ingest.url;
}

process.on('SIGINT', () => {
    console.log('\n[relay] shutting down');
    server.close(() => process.exit(0));
});
