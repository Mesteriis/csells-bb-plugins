"""Narrow CPU adapter for Pipecat Smart Turn v3.2; see PROVENANCE.md.

Accepts 16kHz mono float32 PCM in memory. No audio is logged or retained.
Feature extraction and inference/padding match pinned Pipecat upstream.
"""
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
import numpy as np
import onnxruntime as ort
from _whisper_features import compute_whisper_log_mel_features

options = ort.SessionOptions()
options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
options.inter_op_num_threads = 1
options.intra_op_num_threads = 1
options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
ort.disable_telemetry_events()
model = ort.InferenceSession(os.environ['JARVIS_TURN_MODEL'], sess_options=options)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        self.connection.settimeout(10)
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            self.send_error(400)
            return
        if self.path != '/turn' or length < 4 or length > 1920000 or length % 4:
            self.send_error(400)
            return
        raw = self.rfile.read(length)
        if len(raw) != length:
            self.send_error(400)
            return
        audio = np.frombuffer(raw, dtype='<f4')
        if not np.isfinite(audio).all():
            self.send_error(400)
            return
        audio = audio[-128000:]
        audio = np.pad(audio, (128000 - len(audio), 0), mode='constant')
        features = compute_whisper_log_mel_features(audio, do_normalize=True)
        output = model.run(None, {'input_features': np.expand_dims(features, axis=0)})
        probability = float(output[0][0].item())
        body = json.dumps({'complete': probability > 0.5, 'probability': probability}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

HTTPServer(('127.0.0.1', 4843), Handler).serve_forever()
