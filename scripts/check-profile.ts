import {runProfileCompileCli} from "nbook/scripts/profile-compile-cli";

await runProfileCompileCli(process.argv.slice(2), {
    command: "check-profile",
});
