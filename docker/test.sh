(xvfb-run -a npm test; echo $? > exitcode) | grep -Ev "Failed to connect to the bus|GPU stall due to ReadPixels"
exit $(<exitcode)