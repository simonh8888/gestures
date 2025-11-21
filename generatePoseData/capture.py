import cv2
import mediapipe as mp
import csv
import os

# Initialize MediaPipe Hands and Drawing utilities
mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils
mp_styles = mp.solutions.drawing_styles

# File to store captured poses
CSV_FILE = "hand_landmarks.csv"

# If file doesn’t exist, create and add headers
if not os.path.exists(CSV_FILE):
    with open(CSV_FILE, mode='w', newline='') as f:
        writer = csv.writer(f)
        headers = []
        for i in range(21):  # 21 landmarks
            headers += [f'x_{i}', f'y_{i}', f'z_{i}']
        writer.writerow(headers)

# Initialize webcam
cap = cv2.VideoCapture(0)

# Configure MediaPipe Hands
with mp_hands.Hands(
    static_image_mode=False,       
    max_num_hands=1,               # Track one hand for simplicity
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
) as hands:

    print("Press 'c' to capture hand pose, 'q' to quit.")

    while cap.isOpened():
        success, frame = cap.read()
        if not success:
            print("Ignoring empty camera frame.")
            continue

        # Flip and convert color
        frame = cv2.flip(frame, 1)
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        # Process the frame
        results = hands.process(rgb_frame)

        # Draw landmarks
        if results.multi_hand_landmarks:
            for hand_landmarks in results.multi_hand_landmarks:
                mp_drawing.draw_landmarks(
                    frame, 
                    hand_landmarks, 
                    mp_hands.HAND_CONNECTIONS,
                    mp_styles.get_default_hand_landmarks_style(),
                    mp_styles.get_default_hand_connections_style()
                )

        # Show frame
        cv2.imshow('Hand Tracking - Capture Mode', frame)

        key = cv2.waitKey(5) & 0xFF

        # Capture pose when 'c' is pressed
        if key == ord('c') and results.multi_hand_landmarks:
            hand = results.multi_hand_landmarks[0]  # Take the first hand
            landmarks = []
            for lm in hand.landmark:
                # Format numbers to avoid scientific notation
                landmarks += [f"{lm.x:.10f}", f"{lm.y:.10f}", f"{lm.z:.10f}"]
            with open(CSV_FILE, mode='a', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(landmarks)
            print(f"✅ Captured hand pose — saved {len(landmarks)//3} landmarks to {CSV_FILE}")

        # Quit with 'q'
        if key == ord('q'):
            break

# Cleanup
cap.release()
cv2.destroyAllWindows()
