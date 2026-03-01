const testString1 = "Elsa și Spiderman";
const testString2 = "Elsa si Spiderman si Tom si Jerry";

function splitRoles(rawDetails) {
  const expandedRoles = [];
  const nameSplitRegex = /\s+(?:și|si|&)\s+|,\s*/i;
  if (rawDetails.match(nameSplitRegex)) {
    const subNames = rawDetails.split(nameSplitRegex).map((n) => n.trim()).filter(Boolean);
    if (subNames.length > 1) {
      for (const subName of subNames) {
        expandedRoles.push({
           details: subName,
        });
      }
      return expandedRoles;
    }
  }
  return [{details: rawDetails}];
}

console.log(splitRoles(testString1));
console.log(splitRoles(testString2));
