// src/hooks/useDeviceOrientation.ts
import { useState, useEffect, useRef, useCallback } from "react";

/*
  Implementation notes:
  - Uses the same quaternion construction pipeline as Three.js DeviceOrientationControls:
      euler.set(beta, alpha, -gamma, 'YXZ')
      quaternion.setFromEuler(euler)
      multiply by q1 (-PI/2 about X) and by qScreen (-screenOrient about Z)
  - Extracts Euler from the final quaternion using the YXZ extraction formula
    (same order used to build it). This avoids mismatches.
*/

function deg2rad(d: number) {
    return (d * Math.PI) / 180;
}
function rad2deg(r: number) {
    return (r * 180) / Math.PI;
}

type Quat = { x: number; y: number; z: number; w: number };

function setFromEulerYXZ(x: number, y: number, z: number): Quat {
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

    const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
        const { alpha, beta, gamma } = event;
        if (alpha == null || beta == null || gamma == null) return;

        const screenOrient = getScreenRotation();

        // gamma wrap fix (keep gamma continuous)
        let gammaDeg = gamma;
        if (gamma > 90) gammaDeg = 180 - gamma;
        if (gamma < -90) gammaDeg = -180 - gamma;

        // alpha normalized into [-180, +180]
        const alphaRaw = alpha <= 180 ? alpha : alpha - 360;

        // Quaternion from euler.set(beta, alpha, -gamma, 'YXZ')
        const _alpha = deg2rad(alphaRaw);
        const _beta = deg2rad(beta);
        const _gamma = deg2rad(gammaDeg);

        const qDev = setFromEulerYXZ(_beta, _alpha, -_gamma);
        const q1 = setFromAxisAngle([1, 0, 0], -Math.PI / 2);
        const qScreen = setFromAxisAngle([0, 0, 1], -deg2rad(screenOrient));

        const qTmp = multiplyQuat(qDev, q1);
        const qFinal = multiplyQuat(qTmp, qScreen);

        // Rotation matrix from quaternion
        const qx = qFinal.x, qy = qFinal.y, qz = qFinal.z, qw = qFinal.w;

        const r00 = 1 - 2 * (qy * qy + qz * qz);
        const r02 = 2 * (qx * qz + qy * qw);

        const r10 = 2 * (qx * qy + qz * qw);
        const r11 = 1 - 2 * (qx * qx + qz * qz);
        const r12 = 2 * (qy * qz - qx * qw);

        const r20 = 2 * (qx * qz - qy * qw);
        const r22 = 1 - 2 * (qx * qx + qy * qy);

        const m11 = r00;
        const m13 = r02;
        const m21 = r10;
        const m22 = r11;
        const m23 = r12;
        const m31 = r20;
        const m33 = r22;

        // Standard YXZ extraction (no smoothing)
        const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

        const xRad = Math.asin(clamp(-m23, -1, 1));
        let yRad: number, zRad: number;
        if (Math.abs(m23) < 0.9999999) {
            yRad = Math.atan2(m13, m33);
            zRad = Math.atan2(m21, m22);
        } else {
            // singular fallback
            yRad = Math.atan2(-m31, m11);
            zRad = 0;
        }

        // final degrees
        let pitchDeg = rad2deg(xRad);
        let yawDeg = rad2deg(yRad);
        let rollDeg = rad2deg(zRad);

        if (yawOffsetRef.current == null) yawOffsetRef.current = yawDeg;
        yawDeg = normalize(yawDeg - (yawOffsetRef.current ?? 0));
        rollDeg = normalize(rollDeg);

        // Apply corrections: 180° shift and direction-change to user-facing 'yaw'
        setYaw(normalize( 180 - yawDeg));
        // Pitch can go as it is
        setPitch(pitchDeg);
        // Apply corrections: direction-change to user-facing 'pitch'
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
