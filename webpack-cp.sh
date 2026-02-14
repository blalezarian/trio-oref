#!/bin/bash

# Launch this script by typing /bin/bash webpack-cp.sh
#
# or with rexcutable permission: ./webpack-cp.sh
#
# modify permission by typing chmod a+x webpack-cp.sh
#
# perform webpack on the nine .ts entry points:
#
# ./src/iob/index.ts
# ./src/meal/index.ts
# ./src/determineBasal/index.ts
# ./src/glucose/index.ts
# ./src/setTempBasal/index.ts
# ./src/autosens/index.ts
# ./src/profile/index.ts
# ./src/autotunePrep/index.ts
# ./src/autotune/index.ts

npx webpack

#
#  --- Copy and rename oref0/dist .js files to Trio/Resources/javascript/bundle ---
#
# change directory variables as needed:
oref0DIR=./
apsDIR=../Trio


bundleDIR=$apsDIR/Trio/Resources/javascript/bundle

cp -p -v $oref0DIR/dist/bundle/*.js $bundleDIR/

echo ""
echo "copying /src/ source files to Trio/trio-oref"
echo ""
echo ""

cp -p -R $oref0DIR/src $apsDIR/trio-oref/
echo "These source files are copied from https://github.com/nightscout/trio-oref, and are for information purposes only." > $apsDIR/trio-oref/oref_source_file_info.txt
echo "The algorithm is run based on minimised files in Trio/Resources/javascript/bundle." >> $apsDIR/trio-oref/oref_source_file_info.txt

# Retrieves version, branch, and tag information from Git
git_version=$(git log -1 --format="%h" --abbrev=7)
git_branch=$(git symbolic-ref --short -q HEAD)
git_tag=$(git describe --tags --exact-match 2>/dev/null)

# Determines branch or tag information
git_branch_or_tag="${git_branch:-${git_tag}}"
git_branch_or_tag_version="${git_branch_or_tag} - git version: ${git_version}"

echo "oref0 branch: ${git_branch_or_tag_version}" > $apsDIR/oref0_source_version.txt
echo "" >> $apsDIR/oref0_source_version.txt
echo "Last commits:" >> $apsDIR/oref0_source_version.txt
git log --since=2024-01-01 --oneline --abbrev=7 >> $apsDIR/oref0_source_version.txt

exit
