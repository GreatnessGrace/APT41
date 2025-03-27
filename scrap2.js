const axios = require("axios");
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config();

const GITHUB_TOKEN = process.env.PAT; 

const headers = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "Mozilla/5.0",
    ...(GITHUB_TOKEN ? { "Authorization": `token ${GITHUB_TOKEN}` } : {})
};

const repoSearchURL = `https://api.github.com/search/repositories?q=("APT41" OR "APT 41" OR "APT-41" OR "APT_41")+in:name,description+India`;
const codeSearchURL = `https://api.github.com/search/code?q=APT41+India+in:file`;
const issueSearchURL = `https://api.github.com/search/issues?q=("APT41" OR "APT 41" OR "APT-41" OR "APT_41")+in:title,body`;
// const issueSearchURL = `https://api.github.com/search/issues?q=("APT41" OR "APT 41" OR "APT-41" OR "APT_41") AND India in:title,body`;

const PER_PAGE = 100;
const MAX_RESULTS = 900;

// Function to save extracted data to a file
function saveToFile(filename, data) {
    if (data.length === 0) {
        console.log(`No relevant data found for ${filename}`);
        fs.writeFileSync(filename, JSON.stringify({ message: "No relevant data found" }, null, 2));
    } else {
        fs.writeFileSync(filename, JSON.stringify(data, null, 2));
        console.log(`Data saved to ${filename}`);
    }
}

// Check GitHub rate limit
async function checkRateLimit() {
    try {
        const { data } = await axios.get("https://api.github.com/rate_limit", { headers });
        return data.rate.remaining;
    } catch (error) {
        console.error("Error checking rate limit:", error.message);
        return 0;
    }
}

// Fetch paginated GitHub data and extract relevant information
async function fetchAllGitHubData(url, filename, extractFunction) {
    let page = 1;
    let allItems = [];

    try {
        while (allItems.length < MAX_RESULTS) {
            let remainingRequests = await checkRateLimit();
            if (remainingRequests < 5) {
                console.log(`Rate limit reached. Stopping fetch for ${filename}.`);
                break;
            }

            console.log(`Fetching page ${page} for ${filename}...`);
            const { data } = await axios.get(`${url}&per_page=${PER_PAGE}&page=${page}`, { headers });

            if (!data.items || data.items.length === 0) break;

            const extractedItems = data.items.map(extractFunction);
            allItems.push(...extractedItems);

            if (data.items.length < PER_PAGE) break;
            page++;

            if (allItems.length >= MAX_RESULTS) break;
        }

        saveToFile(filename, allItems.slice(0, MAX_RESULTS));
        return allItems.slice(0, MAX_RESULTS);
    } catch (error) {
        console.error(`Error fetching data for ${filename}:`, error.response ? error.response.data : error.message);
        return [];
    }
}


// Extract relevant data from repositories
function extractRepoData(repo) {
    return {
        name: repo.full_name,
        url: repo.html_url,
        description: repo.description || "No description",
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        open_issues: repo.open_issues_count,
        language: repo.language || "Not specified",
        created_at: repo.created_at,
        updated_at: repo.updated_at
    };
}

// Extract relevant data from code files
function extractCodeData(item) {
    const text = item.name + " " + item.path;
    const iocs = extractIOCs(text);

    return {
        name: item.name,
        path: item.path,
        repository: item.repository.full_name,
        url: item.html_url,
        repository_url: item.repository.html_url,
        iocs: iocs
    };
}

function saveIOCsToFile(filename, data) {
    let categorizedIOCs = {
        ipv4: new Set(),
        md5: new Set(),
        sha1: new Set(),
        sha256: new Set(),
        domain: new Set(),
        url: new Set()
    };

    data.forEach(item => {
        Object.entries(item.iocs).forEach(([type, iocList]) => {
            if (categorizedIOCs[type]) {
                iocList.forEach(ioc => categorizedIOCs[type].add(ioc));
            }
        });
    });

    // Convert Sets to Arrays for JSON storage
    const finalIOCs = {};
    Object.entries(categorizedIOCs).forEach(([type, iocSet]) => {
        finalIOCs[type] = [...iocSet];
    });

    if (Object.values(finalIOCs).every(arr => arr.length === 0)) {
        console.log(`No IOCs found for ${filename}`);
        fs.writeFileSync(filename, JSON.stringify({ message: "No IOCs found" }, null, 2));
    } else {
        fs.writeFileSync(filename, JSON.stringify(finalIOCs, null, 2));
        console.log(`Extracted IOCs saved to ${filename}`);
    }
}



// Extract relevant data from issues
function extractIssueData(item) {
    const text = `${item.title}\n${item.body || ""}`;
    const iocs = extractIOCs(text);

    return {
        title: item.title,
        url: item.html_url,
        state: item.state,
        comments: item.comments,
        created_at: item.created_at,
        updated_at: item.updated_at,
        user: {
            username: item.user.login,
            profile_url: item.user.html_url
        },
        iocs: iocs 
    };
}


// Extract relevant data from issues
// function extractIssueData(item) {
//     if (item.title.toLowerCase().includes("india") || item.body?.toLowerCase().includes("india")) {
//         return {
//             title: item.title,
//             url: item.html_url,
//             state: item.state,
//             comments: item.comments,
//             created_at: item.created_at,
//             updated_at: item.updated_at,
//             user: {
//                 username: item.user.login,
//                 profile_url: item.user.html_url
//             }
//         };
//     }
//     return null; // Exclude non-matching items
// }

async function runScraper() {
    await fetchAllGitHubData(repoSearchURL, "repositories_filtered.json", extractRepoData);
    await fetchAllGitHubData(codeSearchURL, "code_files_filtered.json", extractCodeData);
    await fetchAllGitHubData(issueSearchURL, "issues_filtered.json", extractIssueData);
}

const IOC_PATTERNS = {
    ipv4: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    md5: /\b[a-fA-F0-9]{32}\b/g,
    sha1: /\b[a-fA-F0-9]{40}\b/g,
    sha256: /\b[a-fA-F0-9]{64}\b/g,
    domain: /\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b/g,
    url: /\bhttps?:\/\/[^\s]+/g
};

// Function to extract IOCs from a text
function extractIOCs(text) {
    const iocs = {};
    for (const [type, pattern] of Object.entries(IOC_PATTERNS)) {
        const matches = text.match(pattern);
        if (matches) {
            iocs[type] = [...new Set(matches)]; // Remove duplicates
        }
    }
    return iocs;
}


async function runScraper() {
    const issueData = await fetchAllGitHubData(issueSearchURL, "issues_filtered.json", extractIssueData);
    const codeData = await fetchAllGitHubData(codeSearchURL, "code_files_filtered.json", extractCodeData);

    if ((!issueData || issueData.length === 0) && (!codeData || codeData.length === 0)) {
        console.log("No issue or code data retrieved.");
        return;
    }

    // Combine IOCs from issues and code files
    const combinedData = [...(issueData || []), ...(codeData || [])];

    saveIOCsToFile("iocs_extracted.json", combinedData);
}



runScraper();
