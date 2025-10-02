/**
 * App component - serves as the root of the React application.
 * It renders the OrientationPanel component which displays the device
 * orientation (pitch, roll, yaw) in real-time.
 */

import React from "react";
import {OrientationPanel} from "./components/OrientationPanel";
import './App.css'
import {DeviceOrientationProvider} from "../../src";

const App: React.FC = () => {
  return (
      <>
          <DeviceOrientationProvider>
              <h1>Device Orientation Demo</h1>
              <p>
                  This panel shows the real-time orientation of your device, including
                  pitch, roll, and yaw. Tilt or rotate your device to see the values update.
              </p>
              <OrientationPanel />
          </DeviceOrientationProvider>
      </>
  )
}

export default App
