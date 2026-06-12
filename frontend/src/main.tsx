import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { ControlRoute, StudioPage } from "./App";
import "./styles.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <StudioPage />
  },
  {
    path: "/studio",
    element: <StudioPage />
  },
  {
    path: "/control/:token",
    element: <ControlRoute />
  }
]);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
