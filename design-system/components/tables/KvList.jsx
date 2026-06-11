import React from "react";
import { Tag } from "../indicators/Tag.jsx";

/** Key-value rows — system context, account identity, backend status. */
export function KvList({ items }) {
  return (
    <div className="kv-list">
      {items.map((item) => (
        <div className="kv-row" key={item.k}>
          <span className="kv-key">{item.k}</span>
          {item.tag ? (
            <Tag accent={item.tag === "accent"}>{item.v}</Tag>
          ) : (
            <span className="kv-val">{item.v}</span>
          )}
        </div>
      ))}
    </div>
  );
}
