import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

export interface EyeScores {
  left: number;
  right: number;
  confidence: number;
}

export class FaceEyeDetector {
  private landmarker: FaceLandmarker | null = null;

  async initialize(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks("/wasm");
    const options = {
      baseOptions: {
        modelAssetPath: "/models/face_landmarker.task",
        delegate: "GPU" as const,
      },
      runningMode: "VIDEO" as const,
      numFaces: 1,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
    };

    try {
      this.landmarker = await FaceLandmarker.createFromOptions(vision, options);
    } catch {
      this.landmarker = await FaceLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: "CPU" },
      });
    }
  }

  detect(video: HTMLVideoElement, timestamp: number): EyeScores | null {
    if (!this.landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    const result = this.landmarker.detectForVideo(video, timestamp);
    const categories = result.faceBlendshapes[0]?.categories;
    if (!categories?.length) return null;
    const points = result.faceLandmarks[0];
    if (!points) return null;
    const leftCorner = points[33], rightCorner = points[263], nose = points[1];
    if (!leftCorner || !rightCorner || !nose) return null;
    const eyeWidth = Math.abs(rightCorner.x - leftCorner.x);
    const center = (rightCorner.x + leftCorner.x) / 2;
    // Geometric acceptance gate, not a clinical confidence score.
    const inFrame = [leftCorner, rightCorner, nose].every(p => p.x > 0.02 && p.x < 0.98 && p.y > 0.02 && p.y < 0.98);
    if (!inFrame || eyeWidth < 0.08 || Math.abs(nose.x - center) > eyeWidth * 0.38) return null;

    const score = (name: string): number =>
      categories.find((category) => category.categoryName === name)?.score ?? 0;
    const left = score("eyeBlinkLeft");
    const right = score("eyeBlinkRight");
    const asymmetry = Math.abs(left - right);

    return {
      left,
      right,
      confidence: Math.max(0, 1 - asymmetry),
    };
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
