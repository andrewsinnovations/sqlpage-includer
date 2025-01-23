#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Function to determine if a file is text or binary
function isTextFile(filePath, textExtensions) {
    const ext = path.extname(filePath).toLowerCase();
    return textExtensions.has(ext);
}

// Function to process an include recursively
function resolveIncludes(filePath, includeRoot, maxRecursion, currentDepth = 0) {
    if (currentDepth > maxRecursion) {
        throw new Error(`Max recursion depth exceeded while processing includes in ${filePath}`);
    }

    try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const lines = fileContent.split(/\r?\n/);
        let resolvedContent = '';

        for (const line of lines) {
            if (line.startsWith('##include')) {
                const match = line.match(/##include\s+<(.+)>/);
                if (match) {
                    const includeFilePath = path.resolve(includeRoot, match[1]);
                    if (fs.existsSync(includeFilePath)) {
                        resolvedContent += resolveIncludes(includeFilePath, includeRoot, maxRecursion, currentDepth + 1) + '\n';
                    } else {
                        console.error(`Error: File not found - ${includeFilePath}`);
                    }
                } else {
                    console.error(`Error: Malformed include directive - ${line}`);
                }
            } else {
                resolvedContent += line + '\n';
            }
        }

        return resolvedContent;
    } catch (error) {
        throw new Error(`Error processing file ${filePath}: ${error.message}`);
    }
}

// Function to process a text file
async function processTextFile(filePath, outputDir, includeRoot, maxRecursion, watchRoot) {
    try {
        const resolvedContent = resolveIncludes(filePath, includeRoot, maxRecursion);

        const relativePath = path.relative(watchRoot, filePath);
        const outputFilePath = path.join(outputDir, relativePath);
        fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });
        fs.writeFileSync(outputFilePath, resolvedContent, 'utf-8');

        console.log(`Processed text file written to: ${outputFilePath}`);
    } catch (error) {
        console.error(error.message);
    }
}

// Function to copy a binary file to the output directory
function copyBinaryFile(filePath, outputDir, watchRoot) {
    try {
        const relativePath = path.relative(watchRoot, filePath);
        const outputFilePath = path.join(outputDir, relativePath);
        fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });
        fs.copyFileSync(filePath, outputFilePath);
        console.log(`Copied binary file to: ${outputFilePath}`);
    } catch (error) {
        console.error(`Error copying file ${filePath}:`, error.message);
    }
}

// Function to process the entire input directory recursively
function processDirectory(inputDir, outputDir, textExtensions, includeRoot, maxRecursion, watchRoot) {
    const files = fs.readdirSync(inputDir);

    for (const file of files) {
        const filePath = path.join(inputDir, file);

        // Skip processing if the output directory is a child of the input directory
        if (path.resolve(filePath).startsWith(path.resolve(outputDir))) {
            continue;
        }

        if (fs.lstatSync(filePath).isDirectory()) {
            processDirectory(filePath, outputDir, textExtensions, includeRoot, maxRecursion, watchRoot);
        } else if (isTextFile(filePath, textExtensions)) {
            processTextFile(filePath, outputDir, includeRoot, maxRecursion, watchRoot);
        } else {
            copyBinaryFile(filePath, outputDir, watchRoot);
        }
    }
}

// Function to watch files and directories recursively
function watchDirectory(directory, outputDir, textExtensions, includeRoot, maxRecursion, childProcess, watchRoot) {
    const watcher = fs.watch(directory, { recursive: true }, (eventType, filename) => {
        console.log(eventType, filename);
        if (filename) {
            const filePath = path.join(directory, filename);

            // Skip processing if the output directory is a child of the input directory
            if (path.resolve(filePath).startsWith(path.resolve(outputDir))) {
                return;
            }

            if (fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()) {
                if (isTextFile(filePath, textExtensions)) {
                    console.log(`Text file changed: ${filePath}`);
                    processTextFile(filePath, outputDir, includeRoot, maxRecursion, watchRoot);
                } else {
                    console.log(`Binary file changed: ${filePath}`);
                    copyBinaryFile(filePath, outputDir, watchRoot);
                }
            }
        }
    });

    childProcess.on('close', (code) => {
        console.log(`Child process exited with code ${code}. Stopping watcher.`);
        watcher.close();
    });

    console.log(`Watching directory: ${directory}`);
}

// Function to remove and recreate the output directory
function resetOutputDirectory(outputDir, skipDelete) {
    if (!skipDelete) {
        if (fs.existsSync(outputDir)) {
            fs.rmSync(outputDir, { recursive: true, force: true });
            console.log(`Removed existing output directory: ${outputDir}`);
        }
        fs.mkdirSync(outputDir, { recursive: true });
        console.log(`Recreated output directory: ${outputDir}`);
    } else {
        console.log(`Skipped deleting existing output directory: ${outputDir}`);
    }
}

// Function to spawn a child process
function spawnChildProcess(command, outputDir) {
    const child = spawn(command, { cwd: outputDir, shell: true, stdio: 'inherit' });

    child.on('error', (error) => {
        console.error(`Failed to start child process: ${error.message}`);
    });

    return child;
}

// Display usage information
function showUsage() {
    console.log(`Usage: node index.js --watch=<inputDir> --output=<outputDir> [--textExtensions=<extensions>] [--skipDelete] [--childProcess=<command>] [--includeRoot=<directory>] [--maxRecursion=<depth>]`);
    console.log(`  --watch         - Directory to watch for file changes (default: current directory)`);
    console.log(`  --output        - Directory to save processed files (default: dist/ in inputDir)`);
    console.log(`  --textExtensions - Additional comma-separated text file extensions (default: .txt,.html,.js,.css,.json,.md,.sql)`);
    console.log(`  --skipDelete    - Skip deleting the output directory if it already exists`);
    console.log(`  --childProcess  - Command to spawn a child process with the output directory as the working directory (default: sqlpage)`);
    console.log(`  --includeRoot   - Root directory for includes (default: input directory)`);
    console.log(`  --maxRecursion  - Maximum depth for resolving includes (default: 10)`);
}

// Parse command-line arguments
function parseArguments() {
    const args = process.argv.slice(2);
    const options = {
        watch: path.resolve('./'),
        output: path.join(path.resolve('./'), 'dist'),
        textExtensions: new Set(['.txt', '.html', '.js', '.css', '.json', '.md', '.sql']),
        skipDelete: false,
        childProcess: 'sqlpage',
        includeRoot: null,
        maxRecursion: 10
    };

    args.forEach(arg => {
        if (arg.startsWith('--watch=')) {
            options.watch = path.resolve(arg.split('=')[1]);
        } else if (arg.startsWith('--output=')) {
            options.output = path.resolve(arg.split('=')[1]);
        } else if (arg.startsWith('--textExtensions=')) {
            const extensions = arg.split('=')[1].split(',').map(ext => ext.trim().toLowerCase());
            extensions.forEach(ext => options.textExtensions.add(ext));
        } else if (arg === '--skipDelete') {
            options.skipDelete = true;
        } else if (arg.startsWith('--childProcess=')) {
            options.childProcess = arg.split('=')[1];
        } else if (arg.startsWith('--includeRoot=')) {
            options.includeRoot = path.resolve(arg.split('=')[1]);
        } else if (arg.startsWith('--maxRecursion=')) {
            options.maxRecursion = parseInt(arg.split('=')[1], 10);
        } else if (arg === '--help' || arg === '-h') {
            showUsage();
            process.exit(0);
        }
    });

    if (!options.includeRoot) {
        options.includeRoot = options.watch;
    }

    return options;
}

// Main script execution
const { watch, output, textExtensions, skipDelete, childProcess: command, includeRoot, maxRecursion } = parseArguments();

if (fs.existsSync(watch) && fs.lstatSync(watch).isDirectory()) {
    resetOutputDirectory(output, skipDelete);
    processDirectory(watch, output, textExtensions, includeRoot, maxRecursion, watch);
    const child = spawnChildProcess(command, output);
    watchDirectory(watch, output, textExtensions, includeRoot, maxRecursion, child, watch);
} else {
    console.error(`Error: Input directory not found - ${watch}`);
    showUsage();
    process.exit(1);
}
