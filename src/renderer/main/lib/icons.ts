import { addCollection } from "@iconify/react";
import ph from "../../assets/icons/ph.json";

let registered = false;
export const registerIcons = (): void => {
  if (registered) return;
  registered = true;
  addCollection(ph);
};

// Importing this module is the registration step: the window entries import it
// for this side effect, so the set is ready before any Icon renders.
registerIcons();
