set -ex

current_directory=$(pwd)

mkdir /tmp/code
cp -r ./ /tmp/code/
cd /tmp/code

npm ci
npm run lint
npm run format
npm run package

(xvfb-run -a npm run coverage; echo $? > exitcode) | grep -Ev "Failed to connect to the bus|GPU stall due to ReadPixels" && rm -rf "${current_directory}/coverage" && (cp -R ./coverage $current_directory || true)
exit $(<exitcode)