// src/hooks/useDeviceOrientation.ts
import { useState, useEffect, useRef, useCallback } from "react";

/*
  Implementation notes:
  - Uses the same quaternion construction pipeline as Three.js DeviceOrientationControls:
      euler.set(beta, alpha, -gamma, 'YXZ')
      quaternion.setFromEuler(euler)
      multiply by q1 (-PI/2 about X) and by qScreen (-screenOrient about Z)
    (see Three.js DeviceOrientationControls recipe).
  - Extracts Euler from the final quaternion using the YXZ extraction formula
    (same order used to build it). This prevents the build/extract order mismatch.
  - Adds a soft interpolation near the gimbal singularity to avoid abrupt jumps
    when m23 (matrix element) approaches ±1 (the root cause of the "flip").
*/

function deg2rad(d: number) {
    return (d * Math.PI) / 180;
}
function rad2deg(r: number) {
    return (r * 180) / Math.PI;
}

type Quat = { x: number; y: number; z: number; w: number };

function setFromEulerYXZ(x: number, y: number, z: number): Quat {
    // returns quaternion for Euler angles with order YXZ where:
    // x => rotation around X, y => rotation around Y, z => rotation around Z
    const c1 = Math.cos(y / 2);
    const c2 = Math.cos(x / 2);
    const c3 = Math.cos(z / 2);
    const s1 = Math.sin(y / 2);
    const s2 = Math.sin(x / 2);
    const s3 = Math.sin(z / 2);

    return {
        w: c1 * c2 * c3 + s1 * s2 * s3,
        x: c1 * s2 * c3 + s1 * c2 * s3,
        y: s1 * c2 * c3 - c1 * s2 * s3,
        z: c1 * c2 * s3 - s1 * s2 * c3,
    };
}

function multiplyQuat(a: Quat, b: Quat): Quat {
    return {
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    };
}

function setFromAxisAngle(axis: [number, number, number], angleRad: number): Quat {
    const half = angleRad / 2;
    const s = Math.sin(half);
    return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(half) };
}

export function useDeviceOrientation() {
    const [yaw, setYaw] = useState(0);
    const [pitch, setPitch] = useState(0);
    const [roll, setRoll] = useState(0);
    const [permissionGranted, setPermissionGranted] = useState(false);

    // yaw offset for "resetYaw"
    const yawOffsetRef = useRef<number | null>(null);

    const normalize = (angle: number) => ((angle + 180) % 360 + 360) % 360 - 180;
    const resetYaw = useCallback(() => {
        yawOffsetRef.current = null;
    }, []);

    const getScreenRotation = () => {
        if (screen.orientation && (screen.orientation as any).type) {
            const type = (screen.orientation as any).type as string;
            if (type.startsWith("portrait")) return type === "portrait-primary" ? 0 : 180;
            return type === "landscape-primary" ? 90 : -90;
        }
        if (typeof (window as any).orientation === "number") {
            const w = (window as any).orientation as number;
            return w === 0 ? 0 : w === 180 ? 180 : w === 90 ? 90 : -90;
        }
        return window.innerWidth > window.innerHeight ? 90 : 0;
    };

    /*
      Tuning parameters for singularity handling:
      - SINGULAR_START: when |m23| passes this value we start blending toward the fallback extraction
        (prevents abrupt jumps).
      - SINGULAR_HARD: hard threshold used by canonical formula (three.js uses ~0.9999999).
    */
    const SINGULAR_START = 0.995; // start smoothing when very close to singularity
    const SINGULAR_HARD = 0.9999999; // exact singularity threshold used by canonical routines

    const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
        const { alpha, beta, gamma } = event;
        if (alpha == null || beta == null || gamma == null) return;

        // screen orientation correction
        const screenOrient = getScreenRotation();

        // gamma wrap fix (keeps gamma continuous)
        let gammaDeg = gamma;
        if (gamma > 90) gammaDeg = 180 - gamma;
        if (gamma < -90) gammaDeg = -180 - gamma;

        // alpha normalized into [-180, +180]
        const alphaRaw = alpha <= 180 ? alpha : alpha - 360;

        // Build quaternion following Three.js DeviceOrientationControls recipe:
        // euler.set(beta, alpha, -gamma, 'YXZ')
        // quaternion.setFromEuler(euler)
        // multiply by q1 (-PI/2 about X) and by qScreen (-screenOrient about Z)
        const _alpha = deg2rad(alphaRaw);
        const _beta = deg2rad(beta);
        const _gamma = deg2rad(gammaDeg);

        const qDev = setFromEulerYXZ(_beta, _alpha, -_gamma);
        const q1 = setFromAxisAngle([1, 0, 0], -Math.PI / 2); // -90deg about X
        const qScreen = setFromAxisAngle([0, 0, 1], -deg2rad(screenOrient));

        // qFinal = qDev * q1 * qScreen  (same order as three.js's multiply calls)
        const qTmp = multiplyQuat(qDev, q1);
        const qFinal = multiplyQuat(qTmp, qScreen);

        // Build rotation matrix elements from quaternion (row-major):
        // r00 r01 r02
        // r10 r11 r12
        // r20 r21 r22
        const qx = qFinal.x;
        const qy = qFinal.y;
        const qz = qFinal.z;
        const qw = qFinal.w;

        const r00 = 1 - 2 * (qy * qy + qz * qz);
        const r02 = 2 * (qx * qz + qy * qw);

        const r10 = 2 * (qx * qy + qz * qw);
        const r11 = 1 - 2 * (qx * qx + qz * qz);
        const r12 = 2 * (qy * qz - qx * qw);

        const r20 = 2 * (qx * qz - qy * qw);
        const r22 = 1 - 2 * (qx * qx + qy * qy);

        // Map to three.js m_ij names used in Euler.setFromQuaternion:
        const m11 = r00; // m11
        const m13 = r02; // m13
        const m21 = r10; // m21
        const m22 = r11; // m22
        const m23 = r12; // m23
        const m31 = r20; // m31
        const m33 = r22; // m33

        // YXZ extraction (same formulas three.js uses for 'YXZ' setFromQuaternion):
        // x = asin( - clamp(m23) )
        // if abs(m23) < 0.9999999:
        //    y = atan2( m13, m33 )
        //    z = atan2( m21, m22 )
        // else:
        //    y = atan2( - m31, m11 )
        //    z = 0
        const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
        const negM23 = -m23;
        const absM23 = Math.abs(m23);

        // compute nominal angles (no smoothing)
        let xRad = Math.asin(clamp(negM23, -1, 1)); // pitch (X)
        let yRadNominal: number;
        let zRadNominal: number;

        if (absM23 < SINGULAR_HARD) {
            yRadNominal = Math.atan2(m13, m33);
            zRadNominal = Math.atan2(m21, m22);
        } else {
            // canonical singular fallback (three.js uses this)
            yRadNominal = Math.atan2(-m31, m11);
            zRadNominal = 0;
        }

        // Fallback yaw if singular
        const yRadFallback = Math.atan2(-m31, m11);

        // Smooth / interpolate yaw near singularity (avoid abrupt jump at exactly singular)
        let yRad: number;
        if (absM23 < SINGULAR_START) {
            yRad = yRadNominal;
        } else {
            // weight from 0..1 as we approach hard singularity
            const w = Math.min(1, (absM23 - SINGULAR_START) / (1 - SINGULAR_START));
            // lerp between nominal and fallback (better continuity)
            // note: angles must be lerped carefully (wrap-around) — do a shortest-path lerp
            const lerpAngle = (a: number, b: number, t: number) => {
                // normalize difference to [-PI,PI]
                let diff = b - a;
                while (diff < -Math.PI) diff += 2 * Math.PI;
                while (diff > Math.PI) diff -= 2 * Math.PI;
                return a + diff * t;
            };
            yRad = lerpAngle(yRadNominal, yRadFallback, w);
        }

        // final angles in degrees
        let pitchDeg = rad2deg(xRad); // e.x -> pitch
        let yawDeg = rad2deg(yRad); // e.y -> yaw
        let rollDeg = rad2deg(zRadNominal); // e.z -> roll

        // Normalize yaw & apply reset offset (keep previous semantics)
        if (yawOffsetRef.current == null) yawOffsetRef.current = yawDeg;
        yawDeg = normalize(yawDeg - (yawOffsetRef.current ?? 0));

        // Normalize roll
        rollDeg = normalize(rollDeg);

        // Keep sign mapping consistent with your earlier working range:
        // (previous implementation used setYaw(-yawDeg) and setRoll(-rollDeg))
        setYaw(-yawDeg);
        setPitch(pitchDeg);
        setRoll(-rollDeg);
    }, []);

    const requestPermission = useCallback(async () => {
        if (
            typeof DeviceOrientationEvent !== "undefined" &&
            typeof (DeviceOrientationEvent as any).requestPermission === "function"
        ) {
            try {
                const resp = await (DeviceOrientationEvent as any).requestPermission();
                if (resp === "granted") {
                    setPermissionGranted(true);
                    window.addEventListener("deviceorientation", handleOrientation, true);
                } else {
                    alert("Permission denied. Unable to access device orientation.");
                }
            } catch (err) {
                console.error(err);
            }
        } else {
            setPermissionGranted(true);
            window.addEventListener("deviceorientation", handleOrientation, true);
        }
    }, [handleOrientation]);

    useEffect(() => {
        return () => {
            window.removeEventListener("deviceorientation", handleOrientation, true);
        };
    }, [handleOrientation]);

    return { yaw, pitch, roll, resetYaw, permissionGranted, requestPermission };
}
