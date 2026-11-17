import { expect, test } from "bun:test";
import { clean, fields, table } from "../src/format";

test("clean keeps untrusted text on one line and out of table syntax", () => {
  expect(clean("a|b\nc‮`d`")).toBe("a¦b c 'd'");
  expect(clean("a\tb")).toBe("a b");
  expect(clean("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
});

test("table is TSV without empty columns and with shared values hoisted", () => {
  const rows = [
    ["a", "1", "", "ok"],
    ["b", "2", "", "ok"],
    ["c", "3", "", "ok"],
  ];
  expect(table(["name", "n", "empty", "health"], rows)).toBe("same for all: health=ok\nname\tn\na\t1\nb\t2\nc\t3");
  expect(table(["name", "health"], [["a", "ok"], ["b", "ok"]])).toBe("name\thealth\na\tok\nb\tok");
  expect(table(["x"], [])).toBe("(none)");
});

test("fields drops empty values", () => {
  expect(fields([["a", 1], ["b", ""], ["c", undefined], ["", "flag"], ["d", 0]])).toBe("a 1, flag, d 0");
});
