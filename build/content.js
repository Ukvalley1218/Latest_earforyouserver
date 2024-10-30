const fs = require('fs');
function createFolderStructureAndCopyFiles(directoryPath) {
  // Create the directory if it doesn't exist
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath);
  }

  // Get all files and directories in the current directory
  const files = fs.readdirSync('.');

  // Create a string to store the folder structure and file content
  let output = `**Folder Structure**\n\n`;

  // Iterate through each file and directory
  files.forEach(file => {
    const filePath = `${directoryPath}/${file}`;
    if (fs.lstatSync(filePath).isDirectory()) {
      // If it's a directory, create a subdirectory in the output string
      output += `- ${file}\n`;
      createFolderStructureAndCopyFiles(filePath); // Recursively create subdirectories
    } else {
      // If it's a file, copy the file content and add it to the output string
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      output += `\n**${file}**\n\n\`\`\`\n${fileContent}\n\`\`\`\n`;
    }
  });

  // Write the output to a text file
  fs.writeFileSync(`${directoryPath}/folder_structure.txt`, output);
}

// Specify the desired directory path
const directoryPath = 'my_project';

// Create the folder structure and copy files
createFolderStructureAndCopyFiles(directoryPath);