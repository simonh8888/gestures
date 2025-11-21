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

# Track pose ID (will be updated based on existing data)
pose_id = 0

# If file doesn't exist, create and add headers
if not os.path.exists(CSV_FILE):
    with open(CSV_FILE, mode='w', newline='') as f:
        writer = csv.writer(f)
        headers = ['pose_id']
        for i in range(21):  # 21 landmarks
            headers += [f'x_{i}', f'y_{i}', f'z_{i}']
        headers.append('pose')
        writer.writerow(headers)
else:
    # Get the next pose_id from existing data
    with open(CSV_FILE, mode='r') as f:
        reader = csv.reader(f)
        next(reader)  # Skip header
        for row in reader:
            if row:
                pose_id = int(row[0]) + 1

# Current pose label
current_pose = "pointy finger tap"

def list_available_cameras(max_index=10):
    available_cams = []
    for i in range(max_index):
        cap = cv2.VideoCapture(i)
        if cap.isOpened():
            available_cams.append(i)
            cap.release()
    print("cameras" + available_cams)
list_available_cameras(10)

# Initialize webcam
cap = cv2.VideoCapture(0)

# Configure MediaPipe Hands
with mp_hands.Hands(
    static_image_mode=False,       
    max_num_hands=1,               # Track one hand for simplicity
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
) as hands:

    print("Press 'c' to capture hand pose, 'p' to set pose label, 'q' to quit.")
    print(f"Current pose label: {current_pose}")

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

        # Set pose label when 'p' is pressed
        if key == ord('p'):
            current_pose = input("Enter pose label: ")
            print(f"Pose label set to: {current_pose}")

        # Capture pose when 'c' is pressed
        if key == ord('c') and results.multi_hand_landmarks:
            gesture_count += 1
            hand = results.multi_hand_landmarks[0]  # Take the first hand
            landmarks = [pose_id]  # Start with pose_id
            for lm in hand.landmark:
                landmarks += [lm.x, lm.y, lm.z]  # Append x, y, z
            landmarks.append(current_pose)  # Add pose label at end
            with open(CSV_FILE, mode='a', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(landmarks)
            print(f"✅ Captured pose '{current_pose}' (ID: {pose_id}) — saved {len(landmarks)-2} values to {CSV_FILE}")
            pose_id += 1

        # Quit with 'q'
        if key == ord('q'):
            break

# Cleanup
cap.release()
cv2.destroyAllWindows()
