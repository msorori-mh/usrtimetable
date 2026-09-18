import assert from "node:assert/strict";
import {
  assignsAllColleges,
  requiresCollegeAssignment,
  scopeCollegesForRole,
  resolveViewerScopeRedirect,
} from "../../src/lib/viewer-roles";

assert.equal(assignsAllColleges("read_only"), false);
assert.equal(requiresCollegeAssignment("read_only"), true);
assert.equal(assignsAllColleges("institutional_viewer"), true);
assert.equal(requiresCollegeAssignment("institutional_viewer"), false);
assert.equal(requiresCollegeAssignment("college_admin"), true);
assert.equal(assignsAllColleges("college_admin"), false);
const colleges = [{ id: "arts" }, { id: "it" }];
assert.deepEqual(scopeCollegesForRole(colleges, ["arts"], true), [{ id: "arts" }]);
assert.deepEqual(scopeCollegesForRole(colleges, [], true), []);
assert.equal(resolveViewerScopeRedirect({ isReadOnly: true }, "/reports"), null);
assert.equal(resolveViewerScopeRedirect({ isReadOnly: true }, "/users"), "/reports");
console.log("SCOPED_VIEWER_COLLEGES_PASS");
