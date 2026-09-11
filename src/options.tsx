import { createRoot } from "react-dom/client";
import { browserClient } from "./chrome/implementation";
import { Options } from "./ui/Options";
import "./ui/style.css";
void browserClient().then((client) =>
  createRoot(document.getElementById("root")!).render(
    <Options client={client} />,
  ),
);
