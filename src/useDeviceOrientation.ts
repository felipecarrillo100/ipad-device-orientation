// src/hooks/useDeviceOrientation.ts
import { useState, useEffect, useRef, useCallback } from "react";

// ------------------- Helpers -------------------
function deg2rad(d: number) { return (d * Math.PI) / 180; }
function rad2deg(r: number) { return (r * 180) / Math.PI; }

type Quat = { x: number; y: number; z: number; w: number };

// Build quaternion from Euler angles in YXZ order
function setFromEulerYXZ(x: number, y: number, z: number): Quat {
    const c1 = Math.cos(y / 2), c2 = Math.cos(x / 2), c3 = Math.cos(z / 2);
    const s1 = Math.sin(y / 2), s2 = Math.sin(x / 2), s3 = Math.sin(z / 2);
    return {
        w: c1 * c2 * c3 + s1 * s2 * s3,
        x: c1 * s2 * c3 + s1 * c2 * s3,
        y: s1 * c2 * c3 - c1 * s2 * s3,
        z: c1 * c2 * s3 - s1 * s2 * c3,
    };
}

// Multiply two quaternions
function multiplyQuat(a: Quat, b: Quat): Quat {
    return {
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    };
}

// Build quaternion from axis-angle
function setFromAxisAngle(axis: [number, number, number], angleRad: number): Quat {
    const half = angleRad / 2;
    const s = Math.sin(half);
    return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(half) };
}

// Normalize angle to [-180, 180]
const normalize = (angle: number) => ((angle + 180) % 360 + 360) % 360 - 180;

// Detect platform (default iOS)
function detectPlatform(): "ios" | "android" {
    const ua = navigator.userAgent || navigator.vendor || "";
    if (/android/i.test(ua)) return "android";
    return "ios"; // default
}

// ------------------- Hook -------------------
export function useDeviceOrientation(throttleHz = 30) {
    const [yaw, setYaw] = useState(0);
    const [pitch, setPitch] = useState(0);
    const [roll, setRoll] = useState(0);
    const [permissionGranted, setPermissionGranted] = useState(false);

    const yawOffsetRef = useRef<number | null>(null);
    const rawRef = useRef({ alpha: 0, beta: 0, gamma: 0 });
    const screenOrientRef = useRef(getScreenRotation());
    const platformRef = useRef<"ios" | "android">(detectPlatform());

    const resetYaw = useCallback(() => { yawOffsetRef.current = null; }, []);

    // ------------------- Device Orientation Handler -------------------
    const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
        const { alpha, beta, gamma } = event;
        if (alpha == null || beta == null || gamma == null) return;

        // Gamma wrap
        let gammaDeg = gamma;
        if (gamma > 90) gammaDeg = 180 - gamma;
        if (gamma < -90) gammaDeg = -180 - gamma;

        const alphaRaw = alpha <= 180 ? alpha : alpha - 360;
        rawRef.current = { alpha: alphaRaw, beta, gamma: gammaDeg };
    }, []);

    // ------------------- Permission -------------------
    const requestPermission = useCallback(async () => {
        if (typeof DeviceOrientationEvent !== "undefined" &&
            typeof (DeviceOrientationEvent as any).requestPermission === "function") {
            try {
                const resp = await (DeviceOrientationEvent as any).requestPermission();
                if (resp === "granted") {
                    setPermissionGranted(true);
                    window.addEventListener("deviceorientation", handleOrientation, true);
                } else alert("Permission denied.");
            } catch (err) { console.error(err); }
        } else {
            setPermissionGranted(true);
            window.addEventListener("deviceorientation", handleOrientation, true);
        }
    }, [handleOrientation]);

    // ------------------- Screen Rotation Helper -------------------
    function getScreenRotation(): number {
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
    }

    // Update orientation on UI rotation change
    useEffect(() => {
        const updateScreenRotation = () => {
            screenOrientRef.current = getScreenRotation();
        };
        window.addEventListener("orientationchange", updateScreenRotation);
        window.addEventListener("resize", updateScreenRotation);
        return () => {
            window.removeEventListener("orientationchange", updateScreenRotation);
            window.removeEventListener("resize", updateScreenRotation);
        };
    }, []);

    // ------------------- Throttled Update -------------------
    useEffect(() => {
        const intervalMs = 1000 / throttleHz;
        let rafId: number;
        let lastTime = performance.now();

        const updateState = () => {
            const now = performance.now();
            if (now - lastTime >= intervalMs) {
                const { alpha, beta, gamma } = rawRef.current;
                const screenOrient = screenOrientRef.current;

                const _alpha = deg2rad(alpha);
                const _beta = deg2rad(beta);
                const _gamma = deg2rad(gamma);

                const qDev = setFromEulerYXZ(_beta, _alpha, -_gamma);
                const q1 = setFromAxisAngle([1, 0, 0], -Math.PI / 2);
                const qScreen = setFromAxisAngle([0, 0, 1], -deg2rad(screenOrient));

                const qTmp = multiplyQuat(qDev, q1);
                const qFinal = multiplyQuat(qTmp, qScreen);

                const qx = qFinal.x, qy = qFinal.y, qz = qFinal.z, qw = qFinal.w;
                const r00 = 1 - 2 * (qy*qy + qz*qz), r02 = 2*(qx*qz + qy*qw);
                const r10 = 2*(qx*qy + qz*qw), r11 = 1 - 2*(qx*qx + qz*qz), r12 = 2*(qy*qz - qx*qw);
                const r20 = 2*(qx*qz - qy*qw), r22 = 1 - 2*(qx*qx + qy*qy);

                const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
                const xRad = Math.asin(clamp(-r12, -1, 1));

                let yRad: number, zRad: number;
                if (Math.abs(r12) < 0.9999999) {
                    yRad = Math.atan2(r02, r22);
                    zRad = Math.atan2(r10, r11);
                } else {
                    yRad = Math.atan2(-r20, r00);
                    zRad = 0;
                }

                let pitchDeg = rad2deg(xRad);
                let yawDeg = rad2deg(yRad);
                let rollDeg = rad2deg(zRad);

                if (yawOffsetRef.current == null) yawOffsetRef.current = yawDeg;
                yawDeg = normalize(yawDeg - (yawOffsetRef.current ?? 0));
                rollDeg = normalize(rollDeg);

                // ✅ Apply correction based on detected platform
                const correction = platformRef.current === "ios" ? 180 : -90;
                setYaw(normalize(correction - yawDeg));
                setPitch(pitchDeg);
                setRoll(-rollDeg);

                lastTime = now;
            }
            rafId = requestAnimationFrame(updateState);
        };

        rafId = requestAnimationFrame(updateState);
        return () => cancelAnimationFrame(rafId);
    }, [throttleHz]);

    // ------------------- Cleanup -------------------
    useEffect(() => () => {
        window.removeEventListener("deviceorientation", handleOrientation, true);
    }, [handleOrientation]);

    return { yaw, pitch, roll, resetYaw, permissionGranted, requestPermission };
}
