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

const codeSearchURL = `https://api.github.com/search/code?q=APT41+India+in:file`;
const issueSearchURL = `https://api.github.com/search/issues?q=("APT41" OR "APT 41" OR "APT-41" OR "APT_41")+in:title,body`;

const PER_PAGE = 100;
const MAX_RESULTS = 900;

// GitHub API Rate Limit Checker
async function checkRateLimit() {
    try {
        const { data } = await axios.get("https://api.github.com/rate_limit", { headers });
        return data.rate.remaining;
    } catch (error) {
        console.error("Error checking rate limit:", error.message);
        return 0;
    }
}

// Fetch paginated GitHub data
async function fetchAllGitHubData(url, extractFunction, apiName) {
    let page = 1;
    let allItems = [];

    try {
        while (allItems.length < MAX_RESULTS) {
            let remainingRequests = await checkRateLimit();
            if (remainingRequests < 5) {
                console.log(`[${apiName}] Rate limit reached. Stopping fetch.`);
                break;
            }

            console.log(`[${apiName}] Fetching page ${page}...`);
            const { data } = await axios.get(`${url}&per_page=${PER_PAGE}&page=${page}`, { headers });

            if (!data.items || data.items.length === 0) {
                console.log(`[${apiName}] No more data found.`);
                break;
            }

            allItems.push(...data.items.map(extractFunction));

            if (data.items.length < PER_PAGE) {
                console.log(`[${apiName}] All pages fetched.`);
                break;
            }
            page++;

            if (allItems.length >= MAX_RESULTS) break;
        }

        return allItems.slice(0, MAX_RESULTS);
    } catch (error) {
        console.error(`[${apiName}] Error fetching data:`, error.response ? error.response.data : error.message);
        return [];
    }
}



// Extract IOCs from text
const IOC_PATTERNS = {
    ipv4: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    md5: /\b[a-fA-F0-9]{32}\b/g,
    sha1: /\b[a-fA-F0-9]{40}\b/g,
    sha256: /\b[a-fA-F0-9]{64}\b/g,
    domain: /\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b/g,
    url: /\bhttps?:\/\/[^\s]+/g
};

function extractIOCs(text) {
    const iocs = {};
    for (const [type, pattern] of Object.entries(IOC_PATTERNS)) {
        const matches = text.match(pattern);
        if (matches) {
            iocs[type] = [...new Set(matches)];
        }
    }
    return iocs;
}

// Extract IOCs from issues
function extractIssueData(issue) {
    const text = `${issue.title} ${issue.body || ""}`;
    return {
        title: issue.title,
        url: issue.html_url,
        iocs: extractIOCs(text)
    };
}

// Extract IOCs from code files
function extractCodeData(item) {
    const text = item.name + " " + item.path;
    return {
        name: item.name,
        path: item.path,
        repository: item.repository.full_name,
        url: item.html_url,
        iocs: extractIOCs(text)
    };
}

// Verify IOCs using AlienVault OTX
async function verifyIOC(ioc, type) {
    try {
        const response = await axios.get(`https://otx.alienvault.com/api/v1/indicators/${type}/${ioc}`);
        return response.data.pulse_info.count > 0;
    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.warn(`IOC Not Found in OTX: ${ioc}, Type: ${type}`);
            return false;  // Considered unverified if not found
        }
        console.error(`Error verifying IOC: ${ioc}, Type: ${type}, Error:`, error.message);
        return false;
    }
}



// Filter verified IOCs
async function filterVerifiedIOCs(iocs) {
    const verifiedIOCs = {
        ipv4: [],
        md5: [],
        sha1: [],
        sha256: [],
        domain: [],
        url: []
    };

    for (const [type, iocList] of Object.entries(iocs)) {
        for (const ioc of iocList) {
            if (await verifyIOC(ioc, type)) {
                verifiedIOCs[type].push(ioc);
            }
        }
    }

    return verifiedIOCs;
}

// Save only verified IOCs
async function saveVerifiedIOCs(filename, data) {
    let extractedIOCs = {
        ipv4: new Set(),
        md5: new Set(),
        sha1: new Set(),
        sha256: new Set(),
        domain: new Set(),
        url: new Set()
    };

    for (const item of data) {
        for (const [type, iocList] of Object.entries(item.iocs)) {
            iocList.forEach(ioc => extractedIOCs[type].add(ioc));
        }
    }

    let verifiedIOCs = await filterVerifiedIOCs(extractedIOCs);

    // Only save if verified IOCs exist
    const hasVerifiedIOCs = Object.values(verifiedIOCs).some(list => list.length > 0);
    if (!hasVerifiedIOCs) {
        console.log("No verified IOCs found. Skipping file save.");
        return;
    }

    fs.writeFileSync(filename, JSON.stringify(verifiedIOCs, null, 2));
    console.log(`Verified IOCs saved to ${filename}`);
}


// Main Function
async function runScraper() {
    const issueData = await fetchAllGitHubData(issueSearchURL, extractIssueData, "Issues API");
    const codeData = await fetchAllGitHubData(codeSearchURL, extractCodeData, "Code API");

    if ((!issueData || issueData.length === 0) && (!codeData || codeData.length === 0)) {
        console.log("No data retrieved.");
        return;
    }

    const combinedData = [...(issueData || []), ...(codeData || [])];
    await saveVerifiedIOCs("verified_iocs.json", combinedData);
}


runScraper();
