// Static policy audit of the permission decision. No request, code, token,
// patient record, database, or network is involved in this test.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const path = new URL("./phone.ts", import.meta.url);
const source = ts.createSourceFile(path.pathname, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
const decision = source.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "codeRefused",
);

describe("patient phone possession policy", () => {
  it("locates the verification-code authorization decision", () => {
    expect(decision?.body).toBeDefined();
  });

  it.fails("requires independent patient-device possession before granting access based on call ownership", () => {
    const firstBranch = decision?.body?.statements.find(ts.isIfStatement);
    // An unconditional allow on call ownership at the first decision cannot
    // establish the independent patient-device factor. A repaired policy should
    // turn this into an ordinary passing test covering the new policy seam.
    const trustsCallAlone = firstBranch !== undefined
      && ts.isCallExpression(firstBranch.expression)
      && firstBranch.expression.expression.getText(source) === "tokenMatches"
      && ts.isReturnStatement(firstBranch.thenStatement)
      && firstBranch.thenStatement.expression?.kind === ts.SyntaxKind.NullKeyword;
    expect(trustsCallAlone, "Call ownership alone must not establish patient-device possession").toBe(false);
  });
});
