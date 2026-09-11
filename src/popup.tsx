import { createRoot } from "react-dom/client";
import { browserClient } from "./chrome/implementation";
import { Popup } from "./ui/Popup";
import "./ui/style.css";
void browserClient().then((client) =>
  createRoot(document.getElementById("root")!).render(
    <Popup client={client} />,
  ),
);
