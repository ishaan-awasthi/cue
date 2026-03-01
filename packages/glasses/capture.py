# Runs two threads simultaneously.
# Thread one: captures frames from the webcam using OpenCV (cv2.VideoCapture(0)) and resizes them to 640x480.
# Thread two: captures raw PCM audio from the default input device (e.g. AirPods) using pyaudio with 16kHz sample rate,
# mono channel, 16-bit depth — the format Deepgram expects.
# Both threads push their data into a shared thread-safe queue that ws_client.py reads from.
# No inference happens here — capture and queue only.
