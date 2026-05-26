import cv2
import mediapipe as mp
import asyncio
import websockets
import json
import time

WS_URL = "ws://localhost:8000/ws/tracking"
TARGET_FPS = 25
FRAME_INTERVAL = 1.0 / TARGET_FPS

mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils
mp_styles = mp.solutions.drawing_styles


async def stream(ws):
    cap = cv2.VideoCapture(0)
    last_sent = 0.0

    with mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=1,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as hands:
        print("Streaming to server. Press 'q' to quit.")

        while cap.isOpened():
            success, frame = cap.read()
            if not success:
                continue

            frame = cv2.flip(frame, 1)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = hands.process(rgb)

            if results.multi_hand_landmarks and results.multi_handedness:
                hand_landmarks = results.multi_hand_landmarks[0]
                handedness = results.multi_handedness[0].classification[0].label

                mp_drawing.draw_landmarks(
                    frame,
                    hand_landmarks,
                    mp_hands.HAND_CONNECTIONS,
                    mp_styles.get_default_hand_landmarks_style(),
                    mp_styles.get_default_hand_connections_style(),
                )

                now = time.monotonic()
                if now - last_sent >= FRAME_INTERVAL:
                    landmarks = [[lm.x, lm.y, lm.z] for lm in hand_landmarks.landmark]
                    payload = json.dumps({"hand": handedness, "landmarks": landmarks})
                    await ws.send(payload)
                    last_sent = now

            cv2.imshow("Hand Tracking", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cap.release()
    cv2.destroyAllWindows()


async def main():
    print(f"Connecting to {WS_URL} ...")
    async with websockets.connect(WS_URL) as ws:
        print("Connected.")
        await stream(ws)


if __name__ == "__main__":
    asyncio.run(main())
