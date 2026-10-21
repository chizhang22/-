import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Landmark } from "./types";

export class PoseDetector {
  private landmarker: PoseLandmarker | null = null;

  async initialize(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks("/wasm");
    const options = {
      baseOptions: {
        modelAssetPath: "/models/pose_landmarker_lite.task",
        delegate: "GPU" as const,
      },
      runningMode: "VIDEO" as const,
      numPoses: 1,
      minPoseDetectionConfidence: 0.55,
      minPosePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
      outputSegmentationMasks: false,
    };

    try {
      this.landmarker = await PoseLandmarker.createFromOptions(vision, options);
    } catch {
      this.landmarker = await PoseLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: "CPU" },
      });
    }
  }

  detect(video: HTMLVideoElement, timestamp: number): Landmark[] | null {
    if (!this.landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    const result = this.landmarker.detectForVideo(video, timestamp);
    const pose = result.landmarks[0];
    return pose ? pose.map((landmark) => ({ ...landmark })) : null;
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
