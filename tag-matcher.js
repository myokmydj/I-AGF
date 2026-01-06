(function() {
    'use strict';

    var ALL_TAGS = [];
    var fuse = null;
    var isInitialized = false;
    var initPromise = null;
    var FuseClass = null;

    var SYNONYMS = {
        'naked': 'nude',
        'fully naked': 'nude',
        'completely naked': 'nude',
        'nude body': 'nude',

        'blonde': 'blonde_hair',
        'blonde haired': 'blonde_hair',
        'blond': 'blonde_hair',
        'brunette': 'brown_hair',
        'redhead': 'red_hair',
        'red haired': 'red_hair',
        'ginger': 'red_hair',
        'silver haired': 'silver_hair',
        'white haired': 'white_hair',
        'black haired': 'black_hair',
        'pink haired': 'pink_hair',
        'blue haired': 'blue_hair',
        'green haired': 'green_hair',
        'purple haired': 'purple_hair',

        'short': 'short_hair',
        'long': 'long_hair',
        'medium length hair': 'medium_hair',
        'very long': 'very_long_hair',

        'big breasts': 'large_breasts',
        'huge breasts': 'huge_breasts',
        'small breasts': 'flat_chest',
        'flat chest': 'flat_chest',
        'tiny breasts': 'flat_chest',
        'medium breasts': 'medium_breasts',

        'duo': '1boy, 1girl',
        'couple': '1boy, 1girl',
        'solo female': '1girl',
        'solo male': '1boy',
        'single girl': '1girl',
        'single boy': '1boy',
        'two girls': '2girls',
        'two boys': '2boys',
        'three girls': '3girls',
        'multiple girls': 'multiple_girls',

        'smiling': 'smile',
        'happy': 'smile',
        'crying': 'tears',
        'angry': 'angry',
        'surprised': 'surprised',
        'shocked': 'surprised',
        'embarrassed': 'blush',
        'blushing': 'blush',
        'nervous': 'sweat',

        'standing up': 'standing',
        'sitting down': 'sitting',
        'lying': 'lying',
        'laying down': 'lying',
        'kneeling': 'kneeling',
        'squatting': 'squatting',
        'bent over': 'bent_over',
        'from behind': 'from_behind',
        'from front': 'from_front',

        'looking at viewer': 'looking_at_viewer',
        'looking at camera': 'looking_at_viewer',
        'looking away': 'looking_away',
        'looking to the side': 'looking_to_the_side',
        'looking back': 'looking_back',
        'looking down': 'looking_down',
        'looking up': 'looking_up',
        'closed eyes': 'closed_eyes',
        'half closed eyes': 'half-closed_eyes',

        'school uniform': 'school_uniform',
        'sailor uniform': 'serafuku',
        'maid outfit': 'maid',
        'maid costume': 'maid',
        'bikini swimsuit': 'bikini',
        'one piece swimsuit': 'one-piece_swimsuit',
        'dress': 'dress',
        'wedding dress': 'wedding_dress',
        'lingerie': 'lingerie',
        'underwear': 'underwear',
        'panties': 'panties',
        'thong': 'thong',

        'outdoor': 'outdoors',
        'indoor': 'indoors',
        'at night': 'night',
        'at day': 'day',
        'daytime': 'day',
        'nighttime': 'night',
        'in bedroom': 'bedroom',
        'in bathroom': 'bathroom',
        'at school': 'school',
        'at beach': 'beach',
        'in forest': 'forest',
        'in city': 'city',

        'high quality': 'highres',
        'best quality': 'best_quality',
        'masterpiece': 'masterpiece',
        'detailed': 'detailed',
        'highly detailed': 'detailed',

        'close up': 'close-up',
        'closeup': 'close-up',
        'full body': 'full_body',
        'upper body': 'upper_body',
        'lower body': 'lower_body',
        'portrait': 'portrait',
        'face only': 'face',
        'face focus': 'face'
    };

    function loadFuseJS() {
        return new Promise(function(resolve, reject) {
            if (window.Fuse) {
                FuseClass = window.Fuse;
                resolve(window.Fuse);
                return;
            }

            var script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js';
            script.async = true;

            script.onload = function() {
                FuseClass = window.Fuse;
                resolve(window.Fuse);
            };

            script.onerror = function(err) {
                reject(new Error('Failed to load Fuse.js'));
            };

            document.head.appendChild(script);
        });
    }

    function initialize(tagsUrl) {
        if (isInitialized) {
            return Promise.resolve(true);
        }

        if (initPromise) {
            return initPromise;
        }

        initPromise = loadFuseJS()
            .then(function() {
                return fetch(tagsUrl);
            })
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('Failed to load tags: ' + response.status);
                }
                return response.text();
            })
            .then(function(text) {
                ALL_TAGS = JSON.parse(text);

                if (ALL_TAGS.length === 0) {
                    throw new Error('Tags array is empty');
                }

                if (FuseClass) {
                    fuse = new FuseClass(ALL_TAGS, {
                        keys: ['label'],
                        threshold: 0.3,
                        distance: 50,
                        includeScore: true,
                        minMatchCharLength: 2
                    });
                }

                isInitialized = true;
                return true;
            })
            .catch(function(error) {
                initPromise = null;
                return false;
            });

        return initPromise;
    }

    function isReady() {
        return isInitialized;
    }

    function expandSynonyms(tag) {
        var normalized = tag.trim().toLowerCase();
        var synonym = SYNONYMS[normalized];

        if (synonym) {
            if (synonym.indexOf(',') !== -1) {
                return synonym.split(',').map(function(t) { return t.trim(); });
            }
            return [synonym];
        }
        return [normalized];
    }

    function matchSingleTag(tag) {
        var normalizedTag = tag.trim().toLowerCase().replace(/_/g, ' ');

        if (!normalizedTag) {
            return {
                original: tag,
                matched: null,
                alternatives: [],
                status: 'unmatched'
            };
        }

        var exactMatch = ALL_TAGS.find(function(t) { 
            return t.label.toLowerCase() === normalizedTag; 
        });
        if (exactMatch) {
            return {
                original: tag,
                matched: exactMatch,
                alternatives: [],
                status: 'matched'
            };
        }

        var synonymTag = SYNONYMS[normalizedTag.replace(/_/g, ' ')] || SYNONYMS[normalizedTag];
        if (synonymTag && synonymTag.indexOf(',') === -1) {
            var synonymMatch = ALL_TAGS.find(function(t) { 
                return t.label.toLowerCase() === synonymTag.toLowerCase(); 
            });
            if (synonymMatch) {
                return {
                    original: tag,
                    matched: synonymMatch,
                    alternatives: [],
                    status: 'matched'
                };
            }
        }

        var prefixMatches = ALL_TAGS
            .filter(function(t) { return t.label.toLowerCase().startsWith(normalizedTag); })
            .sort(function(a, b) { return b.count - a.count; })
            .slice(0, 5);

        if (prefixMatches.length > 0) {
            return {
                original: tag,
                matched: null,
                alternatives: prefixMatches,
                status: 'fuzzy'
            };
        }

        if (fuse) {
            var fuzzyResults = fuse.search(normalizedTag);

            if (fuzzyResults.length > 0) {
                var alternatives = fuzzyResults
                    .slice(0, 5)
                    .map(function(r) { return r.item; })
                    .sort(function(a, b) { return b.count - a.count; });

                return {
                    original: tag,
                    matched: null,
                    alternatives: alternatives,
                    status: 'fuzzy'
                };
            }
        }

        return {
            original: tag,
            matched: null,
            alternatives: [],
            status: 'unmatched'
        };
    }

    function matchTags(llmTags) {
        if (!isInitialized) {
            return llmTags.map(function(tag) {
                return {
                    original: tag,
                    matched: null,
                    alternatives: [],
                    status: 'unmatched'
                };
            });
        }

        var results = [];

        for (var i = 0; i < llmTags.length; i++) {
            var tag = llmTags[i];
            var expandedTags = expandSynonyms(tag);

            for (var j = 0; j < expandedTags.length; j++) {
                results.push(matchSingleTag(expandedTags[j]));
            }
        }

        return results;
    }

    function parseAndMatchTags(tagString) {
        var tags = tagString
            .split(',')
            .map(function(t) { return t.trim(); })
            .filter(function(t) { return t.length > 0; });

        return matchTags(tags);
    }

    function searchTags(query, limit) {
        if (limit === undefined) limit = 10;
        
        if (!isInitialized) {
            return [];
        }

        var normalizedQuery = query.trim().toLowerCase();

        if (normalizedQuery.length < 2) return [];

        // 앞에서부터 시작하는 태그만 필터링 (prefix match)
        var prefixMatches = ALL_TAGS
            .filter(function(t) { 
                return t.label.toLowerCase().startsWith(normalizedQuery); 
            })
            .sort(function(a, b) { return b.count - a.count; })
            .slice(0, limit);

        return prefixMatches;
    }

    function toPromptString(matchResults, options) {
        if (!options) options = {};
        var useFuzzyBest = options.useFuzzyBest !== undefined ? options.useFuzzyBest : true;
        var keepUnmatched = options.keepUnmatched !== undefined ? options.keepUnmatched : true;

        var finalTags = [];

        for (var i = 0; i < matchResults.length; i++) {
            var result = matchResults[i];
            if (result.status === 'matched' && result.matched) {
                var tag = result.matched.value || result.matched.label;
                finalTags.push(tag.replace(/_/g, ' '));
            } else if (result.status === 'fuzzy' && result.alternatives.length > 0) {
                if (useFuzzyBest) {
                    var fuzzyTag = result.alternatives[0].value || result.alternatives[0].label;
                    finalTags.push(fuzzyTag.replace(/_/g, ' '));
                } else {
                    finalTags.push(result.original.replace(/_/g, ' '));
                }
            } else if (keepUnmatched) {
                finalTags.push(result.original.replace(/_/g, ' '));
            }
        }

        var seen = {};
        var uniqueTags = [];
        for (var k = 0; k < finalTags.length; k++) {
            if (!seen[finalTags[k]]) {
                seen[finalTags[k]] = true;
                uniqueTags.push(finalTags[k]);
            }
        }

        return uniqueTags.join(', ');
    }

    function processPrompt(promptString, options) {
        var results = parseAndMatchTags(promptString);
        var prompt = toPromptString(results, options);

        var matched = 0, fuzzyCount = 0, unmatched = 0;
        for (var i = 0; i < results.length; i++) {
            if (results[i].status === 'matched') matched++;
            else if (results[i].status === 'fuzzy') fuzzyCount++;
            else unmatched++;
        }

        var stats = {
            total: results.length,
            matched: matched,
            fuzzy: fuzzyCount,
            unmatched: unmatched
        };

        return {
            original: promptString,
            prompt: prompt,
            results: results,
            stats: stats
        };
    }

    var TagMatcher = {
        initialize: initialize,
        isReady: isReady,
        matchTags: matchTags,
        parseAndMatchTags: parseAndMatchTags,
        searchTags: searchTags,
        toPromptString: toPromptString,
        processPrompt: processPrompt,
        SYNONYMS: SYNONYMS,
        _getTags: function() { return ALL_TAGS; },
        _getFuse: function() { return fuse; }
    };

    if (typeof window !== 'undefined') {
        window.TagMatcher = TagMatcher;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = TagMatcher;
    }

})();
