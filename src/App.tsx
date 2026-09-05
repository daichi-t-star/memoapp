import { useState } from "react";
import { Workspace } from "./v2/Workspace";
import { scopeOf, type Connection } from "./v2/model";

function savedConnection(): Connection | null {
  try {
    const token = localStorage.getItem("memoapp_gh_token");
    const c = JSON.parse(
      localStorage.getItem("memoapp_selected_repo") || "null",
    );
    return token &&
      c &&
      ["owner", "repo", "branch"].every((k) => typeof c[k] === "string" && c[k])
      ? c
      : null;
  } catch {
    return null;
  }
}
export default function App() {
  const [connection, setConnection] = useState(savedConnection);
  const [token, setToken] = useState(
    () => localStorage.getItem("memoapp_gh_token") || "",
  );
  function connect(c: Connection | null, t: string) {
    if (c) localStorage.setItem("memoapp_selected_repo", JSON.stringify(c));
    else localStorage.removeItem("memoapp_selected_repo");
    if (t) localStorage.setItem("memoapp_gh_token", t);
    else localStorage.removeItem("memoapp_gh_token");
    setToken(t);
    setConnection(c);
  }
  return (
    <Workspace
      key={`${scopeOf(connection)}:${token}`}
      connection={connection}
      token={token}
      onConnect={connect}
    />
  );
}
