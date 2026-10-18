export type ReplicaId = string;

export type ElementId = {
  replicaId: ReplicaId;
  counter: number;
};

export type InsertOperation = {
  type: "insert";
  elementId: ElementId;
  parentId: ElementId | null;
  value: string;
};

export type DeleteOperation = {
  type: "delete";
  elementId: ElementId;
};

export type Operation = InsertOperation | DeleteOperation;

type Element = InsertOperation & {
  deleted: boolean;
};

const rootKey = "HEAD";

function idKey(id: ElementId | null): string {
  return id === null ? rootKey : `${id.replicaId}:${id.counter}`;
}

function compareIds(left: ElementId, right: ElementId): number {
  const replicaOrder = left.replicaId.localeCompare(right.replicaId);
  return replicaOrder !== 0 ? replicaOrder : left.counter - right.counter;
}

export class RgaDocument {
  private elements = new Map<string, Element>();
  private children = new Map<string, ElementId[]>();
  private deletedBeforeInsert = new Set<string>();
  private nextCounter = 1;

  public constructor(public replicaId: ReplicaId) {}

  public insert(parentId: ElementId | null, value: string): InsertOperation {
    if (value.length !== 1) {
      throw new Error("RGA insert currently accepts exactly one character");
    }

    const operation: InsertOperation = {
      type: "insert",
      elementId: { replicaId: this.replicaId, counter: this.nextCounter++ },
      parentId,
      value,
    };
    this.apply(operation);
    return operation;
  }

  public delete(elementId: ElementId): DeleteOperation {
    const operation: DeleteOperation = { type: "delete", elementId };
    this.apply(operation);
    return operation;
  }

  public apply(operation: Operation): boolean {
    if (operation.type === "delete") {
      return this.applyDelete(operation.elementId);
    }

    return this.applyInsert(operation);
  }

  public toString(): string {
    return this.linearizedElements()
      .filter((element) => !element.deleted)
      .map((element) => element.value)
      .join("");
  }

  public get elementCount(): number {
    return this.elements.size;
  }

  public get tombstoneCount(): number {
    return [...this.elements.values()].filter((element) => element.deleted)
      .length;
  }

  private applyInsert(operation: InsertOperation): boolean {
    const key = idKey(operation.elementId);
    if (this.elements.has(key)) {
      return false;
    }

    const element: Element = {
      ...operation,
      deleted: this.deletedBeforeInsert.has(key),
    };
    this.elements.set(key, element);

    const parentKey = idKey(operation.parentId);
    const siblings = this.children.get(parentKey) ?? [];
    siblings.push(operation.elementId);
    siblings.sort(compareIds);
    this.children.set(parentKey, siblings);
    return true;
  }

  private applyDelete(elementId: ElementId): boolean {
    const key = idKey(elementId);
    const element = this.elements.get(key);

    if (element === undefined) {
      const wasAlreadyPending = this.deletedBeforeInsert.has(key);
      this.deletedBeforeInsert.add(key);
      return !wasAlreadyPending;
    }

    if (element.deleted) {
      return false;
    }

    element.deleted = true;
    return true;
  }

  private linearizedElements(): Element[] {
    const result: Element[] = [];

    const visit = (parentId: ElementId | null): void => {
      for (const childId of this.children.get(idKey(parentId)) ?? []) {
        const child = this.elements.get(idKey(childId));
        if (child === undefined) {
          continue;
        }

        result.push(child);
        visit(child.elementId);
      }
    };

    visit(null);
    return result;
  }
}
