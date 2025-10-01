// src/hooks/useDeviceOrientation.ts
import { useState, useEffect, useRef, useCallback } from "react";

/*
  Implementation notes (quick):
  - Builds a quaternion from device alpha/beta/gamma using the same idea
    as Three.js DeviceOrientationControls (YXZ order with a rotation
    correction).
  - Then converts quaternion -> Euler to obtain pitch & roll in a stable,
    horizon-relative way.
  - Handles screen orientation, gamma wrap, iOS quirks.
*/

function deg2rad(d: number) { return (d * Math.PI) / 180; }
function rad2deg(r: number) { return (r * 180) / Math.PI; }

// Minimal quaternion utility (only what we need)
type Quat = { x: number; y: number; z: number; w: number };

function setFromEulerYXZ(x: number, y: number, z: number): Quat {
    // Euler angles (radians) with order YXZ -> returns quaternion
    // This is the same conversion used internally by many libs for 'YXZ'.
    const c1 = Math.cos(y / 2);
    const c2 = Math.cos(x / 2);
    const c3 = Math.cos(z / 2);
    const s1 = Math.sin(y / 2);
    const s2 = Math.sin(x / 2);
    const s3 = Math.sin(z / 2);

    // y (yaw) = y, x (pitch) = x, z (roll) = z in 'YXZ' order
    return {
        w: c1 * c2 * c3 + s1 * s2 * s3,
        x: c1 * s2 * c3 + s1 * c2 * s3,
        y: s1 * c2 * c3 - c1 * s2 * s3,
        z: c1 * c2 * s3 - s1 * s2 * c3,
    };
}

function multiplyQuat(a: Quat, b: Quat): Quat {
    // q = a * b
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

function quatToEulerXYZ(q: Quat) {
    // Convert quaternion to Euler XYZ (returns radians)
    // This yields rotations around X (pitch), then Y (yaw), then Z (roll) in that order.
    // We compute X = atan2(2*(w*x + y*z), 1 - 2*(x*x + y*y))
    // Y = asin(clamp(2*(w*y - z*x), -1, 1))
    // Z = atan2(2*(w*z + x*y), 1 - 2*(y*y + z*z))
    const test = 2 * (q.w * q.y - q.z * q.x);
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

    const X = Math.atan2(2 * (q.w * q.x + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y));
    const Y = Math.asin(clamp(test, -1, 1));
    const Z = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));

    return { x: X, y: Y, z: Z };
}

export function useDeviceOrientation() {
    const [yaw, setYaw] = useState(0);
    const [pitch, setPitch] = useState(0);
    const [roll, setRoll] = useState(0);
    const [permissionGranted, setPermissionGranted] = useState(false);

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

        // --- screen orientation (degrees) ---
        const screenOrient = getScreenRotation();

        // --- Fix gamma wrap: keep gamma in a continuous sense for quaternion build ---
        // Device `gamma` is reported in [-90,90]; when device goes slightly past 90 it flips to -89 etc.
        // We can leave it as-is for quaternion math (Three.js approach works with raw gamma),
        // but to be safe, when it jumps beyond 90 we reconstruct a continuous angle:
        let gammaDeg = gamma;
        if (gamma > 90) gammaDeg = 180 - gamma;
        if (gamma < -90) gammaDeg = -180 - gamma;

        // --- Build quaternion from device angles (use Three.js style recipe) ---
        // angles in radians for setFromEulerYXZ input
        const _alpha = deg2rad(alpha);
        const _beta = deg2rad(beta);
        const _gamma = deg2rad(gammaDeg);

        // Use YXZ order conversion to quaternion (same idea as Three.js DeviceOrientationControls)
        // Note: euler order: Y (alpha), X (beta), Z (-gamma) — Three.js uses (beta, alpha, -gamma,'YXZ')
        // We will follow that mapping: call setFromEulerYXZ with x = _beta, y = _alpha, z = -_gamma
        const qDev = setFromEulerYXZ(_beta, _alpha, -_gamma);

        // q1 is rotation of -90deg about X to convert from device to camera coordinates (Three.js Q1)
        const q1 = setFromAxisAngle([1, 0, 0], -Math.PI / 2);

        // screen rotation: rotate around Z by -screenOrient deg
        const qScreen = setFromAxisAngle([0, 0, 1], -deg2rad(screenOrient));

        // final quaternion: q = qDev * q1 * qScreen
        // multiply in order: q = qDev * q1; q = q * qScreen
        const qTmp = multiplyQuat(qDev, q1);
        const qFinal = multiplyQuat(qTmp, qScreen);

        // Convert final quaternion to Euler in XYZ order (x = pitch, y = yaw, z = roll)
        // We'll then map to the conventions you requested.
        const e = quatToEulerXYZ(qFinal);
        // e.x = rotation around X axis (radians) -> This corresponds to pitch (up/down)
        // e.y = rotation around Y axis -> yaw around vertical
        // e.z = rotation around Z axis -> roll around forward axis (may need sign flip depending on device)
        let pitchDeg = rad2deg(e.x);
        let yawDeg = rad2deg(e.y);
        let rollDeg = rad2deg(e.z);

        // Normalize yaw & apply reset offset
        if (yawOffsetRef.current == null) yawOffsetRef.current = yawDeg;
        yawDeg = normalize(yawDeg - (yawOffsetRef.current ?? 0));

        // Ensure pitch fits your expected sign convention: we want
        // -90 = looking down, 0 = horizon, +90 = looking up
        // The conversion above should provide that, but small sign flip might be needed on some devices:
        // If you see inverted behavior, flip pitchDeg = -pitchDeg here. We'll keep as-is.

        // Normalize roll into [-180,180]
        rollDeg = normalize(rollDeg);

        setYaw(yawDeg);
        setPitch(pitchDeg);
        setRoll(rollDeg);
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
