#!/usr/bin/env node
const readline = require('readline');

console.log("Welcome to the Dummy CLI Agent! Type something and I will echo it.");
console.log("> ");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
});

rl.on('line', (line) => {
    // Simulate some thinking time
    setTimeout(() => {
        console.log(`[Agent Echo] You said: ${line}`);
        console.log("> ");
    }, 500);
});

rl.on('close', () => {
    console.log("Goodbye!");
    process.exit(0);
});
