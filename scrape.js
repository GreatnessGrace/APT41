const axios = require("axios");
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config();

const GITHUB_TOKEN = process.env.PAT; 

// GitHub API Headers
const headers = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "Mozilla/5.0",
    ...(GITHUB_TOKEN ? { "Authorization": `token ${GITHUB_TOKEN}` } : {})
};

// GitHub API Endpoints
// const repoSearchURL = `https://api.github.com/search/repositories?q=APT41+India`;
const repoSearchURL = `https://api.github.com/search/repositories?q=("APT41" OR "APT 41" OR "APT-41" OR "APT_41")+in:name,description+India`;
const codeSearchURL = `https://api.github.com/search/code?q=APT41+India+in:file`;
// const issueSearchURL = `https://api.github.com/search/issues?q=APT41+India`;
// const codeSearchURL = `https://api.github.com/search/code?q=APT41+OR+"APT 41"+OR+"APT-41"+OR+"APT_41"+in:file+India`;
const issueSearchURL = `https://api.github.com/search/issues?q=("APT41" OR "APT 41" OR "APT-41" OR "APT_41")+in:title,body`;

// Function to save data to a file
function saveToFile(filename, data) {
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
    console.log(`Data saved to ${filename}`);
}

async function fetchGitHubRepos() {
    try {
        console.log("Searching GitHub Repositories...");
        const { data } = await axios.get(repoSearchURL, { headers });

        if (data.items.length === 0) {
            console.log("No repositories found.");
            saveToFile("repositories.json", { message: "No repositories found" });
        } else {
            const repos = data.items.map(repo => ({
                name: repo.full_name,
                url: repo.html_url,
                description: repo.description || "No description",
                stars: repo.stargazers_count,
                forks: repo.forks_count,
                open_issues: repo.open_issues_count,
                language: repo.language || "Not specified",
                created_at: repo.created_at,
                updated_at: repo.updated_at
            }));            
            saveToFile("repositories.json", repos);
        }
    } catch (error) {
        console.error("Error fetching GitHub Repositories:", error.message);
    }
}

async function fetchGitHubCode() {
    try {
        console.log("Searching GitHub Code Files...");
        const { data } = await axios.get(codeSearchURL, { headers });

        if (data.items.length === 0) {
            console.log("No relevant code files found.");
            saveToFile("code_files.json", { message: "No relevant code files found" });
        } else {
            const codeFiles = data.items.map(item => ({
                name: item.name,
                path: item.path,
                repository: item.repository.full_name,
                url: item.html_url,
                repository_url: item.repository.html_url
            }));
            saveToFile("code_files.json", codeFiles);
            
        }
    } catch (error) {
        console.error("Error fetching GitHub Code Files:", error.message);
    }
}

async function fetchGitHubIssues() {
    try {
        console.log("Searching GitHub Issues...");
        const { data } = await axios.get(issueSearchURL, { headers });

        if (data.items.length === 0) {
            console.log("No relevant issues found.");
            saveToFile("issues.json", { message: "No relevant issues found" });
        } else {
            const issues = data.items.map(item => ({
                title: item.title,
                url: item.html_url,
                state: item.state,
                comments: item.comments,
                created_at: item.created_at,
                updated_at: item.updated_at,
                user: {
                    username: item.user.login,
                    profile_url: item.user.html_url
                }
            }));
            saveToFile("issues.json", issues);
            
        }
    } catch (error) {
        console.error("Error fetching GitHub Issues:", error.message);
    }
}

async function runScraper() {
    await fetchGitHubRepos();
    await fetchGitHubCode();
    await fetchGitHubIssues();
}

runScraper();
