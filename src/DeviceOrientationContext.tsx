import React, { createContext, useContext, ReactNode } from "react";
import { useDeviceOrientation } from "./useDeviceOrientation";

// Define the shape of the context
export interface DeviceOrientationContextValue {
    yaw: number;
    pitch: number;
    roll: number;
    resetYaw: () => void;
    permissionGranted: boolean;
    requestPermission: () => void;
}

// Create context with empty default value
const DeviceOrientationContext = createContext<DeviceOrientationContextValue | null>(null);

interface DeviceOrientationProviderProps {
    children: ReactNode;
}

export const DeviceOrientationProvider: React.FC<DeviceOrientationProviderProps> = ({ children }) => {
    const orientation = useDeviceOrientation();

    return (
        <DeviceOrientationContext.Provider value={orientation}>
            {children}
        </DeviceOrientationContext.Provider>
    );
};

// Custom hook to consume context
export const useDeviceOrientationContext = (): DeviceOrientationContextValue => {
    const context = useContext(DeviceOrientationContext);
    if (!context) {
        throw new Error(
            "useDeviceOrientationContext must be used within a DeviceOrientationProvider"
        );
    }
    return context;
};
