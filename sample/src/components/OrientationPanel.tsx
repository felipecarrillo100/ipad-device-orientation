import React from "react";
import { useDeviceOrientation } from "../../../src";

export const OrientationPanel: React.FC = () => {
    const { yaw, pitch, roll, resetYaw, permissionGranted, requestPermission } =
        useDeviceOrientation();

    return (
        <div
            style={{
                position: "fixed",
                top: 120,
                left: 20,
                width: 180, // slightly wider for bigger font
                padding: 12,
                background: "rgba(0,0,0,0.7)",
                color: "white",
                fontFamily: "monospace",
                fontSize: 18, // increased font size
                borderRadius: 8,
                zIndex: 9999,
            }}
        >
            {!permissionGranted ? (
                <>
                    <div style={{ marginBottom: 8 }}>Tap below to enable orientation</div>
                    <button
                        onClick={requestPermission}
                        style={{
                            width: "100%",
                            padding: 8,
                            borderRadius: 4,
                            border: "none",
                            cursor: "pointer",
                            marginTop: 6,
                            fontSize: 16, // larger button text
                        }}
                    >
                        Enable Orientation
                    </button>
                </>
            ) : (
                <>
                    <div>Yaw: {yaw.toFixed(1)}°</div>
                    <div>Pitch: {pitch.toFixed(1)}°</div>
                    <div>Roll: {roll.toFixed(1)}°</div>
                    <button
                        onClick={resetYaw}
                        style={{
                            marginTop: 6,
                            width: "100%",
                            padding: 6,
                            borderRadius: 4,
                            border: "none",
                            cursor: "pointer",
                            fontSize: 16,
                        }}
                    >
                        Reset Yaw
                    </button>
                </>
            )}
        </div>
    );
}
