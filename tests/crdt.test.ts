import { describe, expect, it } from "vitest";
import {
  type ElementId,
  RgaDocument,
  type Operation,
} from "../packages/crdt/src/index.js";

describe("RgaDocument", () => {
  it("inserts characters after stable element IDs", () => {
    const document = new RgaDocument("A");
    const first = document.insert(null, "A");
    const second = document.insert(first.elementId, "B");

    expect(document.toString()).toBe("AB");
    expect(second.parentId).toEqual(first.elementId);
  });

  it("keeps deleted elements as tombstones", () => {
    const document = new RgaDocument("A");
    const first = document.insert(null, "A");
    document.insert(first.elementId, "B");

    document.delete(first.elementId);

    expect(document.toString()).toBe("B");
    expect(document.elementCount).toBe(2);
    expect(document.tombstoneCount).toBe(1);
  });

  it("is idempotent when an operation is delivered twice", () => {
    const document = new RgaDocument("A");
    const operation = document.insert(null, "A");

    expect(document.apply(operation)).toBe(false);
    expect(document.toString()).toBe("A");
    expect(document.elementCount).toBe(1);
  });

  it("handles a delete that arrives before its insert", () => {
    const document = new RgaDocument("A");
    const elementId: ElementId = { replicaId: "B", counter: 1 };
    const deleteOperation: Operation = { type: "delete", elementId };
    const insertOperation: Operation = {
      type: "insert",
      elementId,
      parentId: null,
      value: "X",
    };

    expect(document.apply(deleteOperation)).toBe(true);
    expect(document.apply(insertOperation)).toBe(true);
    expect(document.toString()).toBe("");
    expect(document.tombstoneCount).toBe(1);
  });

  it("orders concurrent inserts deterministically on every replica", () => {
    const replicaA = new RgaDocument("A");
    const replicaB = new RgaDocument("B");
    const base = replicaA.insert(null, "A");
    replicaB.apply(base);

    const insertX: Operation = {
      type: "insert",
      elementId: { replicaId: "A", counter: 2 },
      parentId: base.elementId,
      value: "X",
    };
    const insertY: Operation = {
      type: "insert",
      elementId: { replicaId: "B", counter: 1 },
      parentId: base.elementId,
      value: "Y",
    };

    replicaA.apply(insertX);
    replicaA.apply(insertY);
    replicaB.apply(insertY);
    replicaB.apply(insertX);

    expect(replicaA.toString()).toBe("AXY");
    expect(replicaB.toString()).toBe("AXY");
  });

  it("accepts an insert before its parent and renders it after the parent arrives", () => {
    const document = new RgaDocument("A");
    const parent: ElementId = { replicaId: "B", counter: 1 };
    const child: Operation = {
      type: "insert",
      elementId: { replicaId: "B", counter: 2 },
      parentId: parent,
      value: "X",
    };
    const parentOperation: Operation = {
      type: "insert",
      elementId: parent,
      parentId: null,
      value: "A",
    };

    document.apply(child);
    expect(document.toString()).toBe("");

    document.apply(parentOperation);
    expect(document.toString()).toBe("AX");
  });

  it("rejects inserts containing more than one character", () => {
    const document = new RgaDocument("A");

    expect(() => document.insert(null, "AB")).toThrow(
      "RGA insert currently accepts exactly one character",
    );
  });

  it("ignores a duplicate delete operation", () => {
    const document = new RgaDocument("A");
    const element = document.insert(null, "A");
    const deletion = document.delete(element.elementId);

    expect(document.apply(deletion)).toBe(false);
    expect(document.toString()).toBe("");
    expect(document.tombstoneCount).toBe(1);
  });

  it("converges across three replicas despite different delivery orders", () => {
    const base: Operation = {
      type: "insert",
      elementId: { replicaId: "A", counter: 1 },
      parentId: null,
      value: "A",
    };
    const insertB: Operation = {
      type: "insert",
      elementId: { replicaId: "B", counter: 1 },
      parentId: base.elementId,
      value: "B",
    };
    const insertC: Operation = {
      type: "insert",
      elementId: { replicaId: "C", counter: 1 },
      parentId: base.elementId,
      value: "C",
    };
    const deleteB: Operation = {
      type: "delete",
      elementId: insertB.elementId,
    };
    const operations = [base, insertB, insertC, deleteB];
    const replicaA = new RgaDocument("A");
    const replicaB = new RgaDocument("B");
    const replicaC = new RgaDocument("C");

    for (const operation of operations) {
      replicaA.apply(operation);
    }
    for (const operation of [deleteB, insertC, base, insertB]) {
      replicaB.apply(operation);
    }
    for (const operation of [insertC, insertB, deleteB, base]) {
      replicaC.apply(operation);
    }

    expect(replicaA.toString()).toBe("AC");
    expect(replicaB.toString()).toBe("AC");
    expect(replicaC.toString()).toBe("AC");
    expect(replicaA.tombstoneCount).toBe(1);
    expect(replicaB.tombstoneCount).toBe(1);
    expect(replicaC.tombstoneCount).toBe(1);
  });
});
