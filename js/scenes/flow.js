// Top-level flow, mirroring the commands the original posts to its main window
// (0x3905 Presage logo, 0x391d intro, 0x390b main menu, 0x389e.. games).

import { MenuBar, MENUS, CMD } from "../ui/toolkit.js";
import { Logos } from "./logos.js";
import { Intro } from "./intro.js";
import { MainMenu } from "./mainmenu.js";
import { Credits } from "./credits.js";
import { Help } from "../ui/help.js";
import { NameDialog } from "../ui/namedialog.js";

export const GAMES = { 1: "checkers", 2: "fish", 3: "dominoes", 4: "backgammon", 5: "yacht" };
const HELP_OF = { [CMD.HELP_BACKGAMMON]: 1, [CMD.HELP_CHECKERS]: 2, [CMD.HELP_DOMINOES]: 3, [CMD.HELP_FISH]: 4, [CMD.HELP_YACHT]: 5 };

export class App {
  constructor(e) {
    this.e = e;
    e.app = this;
    this.menubar = null;
    this.firstMenu = true;
  }
  setMenu(kind) {
    const e = this.e;
    if (!kind) {
      this.menubar = null;
      e.menubar = null;
      return;
    }
    this.menubar = new MenuBar(e, MENUS[kind], (cmd) => this.command(cmd));
    e.menubar = this.menubar;
  }
  async command(cmd) {
    const e = this.e;
    const scene = e.scene;
    if (scene && scene.onCommand && scene.onCommand(cmd) === true) return;
    if (HELP_OF[cmd]) return this.help(HELP_OF[cmd]);
    switch (cmd) {
      case CMD.CREDITS:
        return e.setScene(new Credits());
      case CMD.EXIT:
        return this.exit();
      case CMD.CHANGE_NAME:
        return this.askName();
      case CMD.EXIT_TO_MENU:
        return this.mainMenu(true);
    }
  }
  async help(game) {
    const e = this.e;
    if (e.scene && e.scene.pause) e.scene.pause(true);
    await new Help(e, game).show();
    if (e.scene && e.scene.pause) e.scene.pause(false);
  }
  async askName() {
    const name = await new NameDialog(this.e, this.e.prefs.name).show();
    if (name !== null) {
      this.e.prefs.name = name.trim() || "My Friend";
      this.e.savePrefs();
      if (this.e.scene && this.e.scene.nameChanged) this.e.scene.nameChanged();
    }
  }
  logos() {
    this.setMenu(null);
    return this.e.setScene(new Logos());
  }
  intro() {
    this.setMenu(null);
    return this.e.setScene(new Intro());
  }
  mainMenu(returning = false) {
    this.setMenu("main");
    const m = new MainMenu(returning);
    return this.e.setScene(m);
  }
  async game(n) {
    const kind = GAMES[n];
    const mod = await import(`../games/${kind}.js`);
    this.setMenu(kind);
    return this.e.setScene(new mod.default());
  }
  exit() {
    this.e.audio.stopMusic();
    this.e.audio.stopSnd();
    location.reload();
  }
}

export function startGame(e, which) {
  const app = new App(e);
  if (which === "menu") return app.mainMenu();
  if (which === "intro") return app.intro();
  if (which && Object.values(GAMES).includes(which)) return app.game(+Object.keys(GAMES).find((k) => GAMES[k] === which));
  if (which === "credits") return e.setScene(new Credits());
  return app.logos();
}
