import "./style.css";
import { createStore } from "./store";
import { App, el } from "./ui";

const app = new App(createStore());
const target = el<HTMLInputElement>("target");
const start = el<HTMLButtonElement>("start");
app.lockWhileBusy(target, start);
target.addEventListener("input", () => app.renderCount(0, Number(target.value) || 0));
start.addEventListener("click", () => void app.run(async () => void (await app.runSet({ target: Number(target.value) }))));
void app.init();
