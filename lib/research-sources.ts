import type { ResearchSourceSeed } from "./research-types";
export type { ResearchSourceSeed } from "./research-types";

// Preserve the 43 mapped sources so teams can opt back in to market monitoring.
// Default collection combines practitioners, original research, and primary industry announcements.
export const RESEARCH_SOURCE_SEEDS: ResearchSourceSeed[] = [
  {
    "id": "original-lennys-archive",
    "name": "Lenny’s archive",
    "url": "https://www.lennysnewsletter.com/archive",
    "kind": "rss",
    "category": "practitioner",
    "enabled": true,
    "notes": "Activation case studies, growth experiments, onboarding, AI product work. Public archive; individual posts may be paid. Homepage returns subscription wall. Public RSS fetched 23 October 2026; paid post excerpts are not full evidence.",
    "priority": 1,
    "feedUrl": "https://www.lennysnewsletter.com/feed",
    "author": "Lenny Rachitsky"
  },
  {
    "id": "original-growth-unhinged-archive",
    "name": "Growth Unhinged archive",
    "url": "https://www.growthunhinged.com/archive",
    "kind": "web",
    "category": "practitioner",
    "enabled": true,
    "notes": "PLG conversion, expansion, pricing, B2B benchmarks, AI GTM. Public beehiiv archive; paginate. Some premium material. Public dated archive verified 23 October 2026; feed was blocked, so use index discovery.",
    "priority": 1,
    "author": "Kyle Poyar"
  },
  {
    "id": "original-elenas-growth-scoop-archive",
    "name": "Elena’s Growth Scoop archive",
    "url": "https://www.elenaverna.com/archive",
    "kind": "rss",
    "category": "practitioner",
    "enabled": true,
    "notes": "Growth loops, retention, experimentation, AI effects on SaaS. Public archive; individual post access varies. Homepage subscription wall. Public RSS fetched 23 October 2026; paid post excerpts are not full evidence.",
    "priority": 1,
    "feedUrl": "https://www.elenaverna.com/feed",
    "author": "Elena Verna"
  },
  {
    "id": "original-reforge-blog",
    "name": "Reforge blog",
    "url": "https://www.reforge.com/blog",
    "kind": "web",
    "category": "practitioner",
    "enabled": false,
    "notes": "Optional source from the original registry; disabled to prioritize individual practitioners. Growth systems, product strategy, AI workflows and research. Public blog; courses and member resources separate.",
    "priority": 2
  },
  {
    "id": "original-productled-blog",
    "name": "ProductLed blog",
    "url": "https://productled.com/blog",
    "kind": "web",
    "category": "practitioner",
    "enabled": false,
    "notes": "Optional source from the original registry; disabled to prioritize individual practitioners. Time to value, onboarding, free-to-paid conversion, PLG operations. Public library with topic filters and dates.",
    "priority": 1
  },
  {
    "id": "original-pma-content-hub",
    "name": "PMA content hub",
    "url": "https://www.productmarketingalliance.com/content-hub/",
    "kind": "rss",
    "category": "practitioner",
    "enabled": false,
    "notes": "Optional source from the original registry; disabled to prioritize individual practitioners. Feature launches, adoption, positioning, customer research. Public and member content mixed.",
    "priority": 1,
    "feedUrl": "https://www.productmarketingalliance.com/rss/"
  },
  {
    "id": "original-mind-the-product",
    "name": "Mind the Product",
    "url": "https://www.mindtheproduct.com/",
    "kind": "web",
    "category": "practitioner",
    "enabled": false,
    "notes": "Optional source from the original registry; disabled to prioritize individual practitioners. Product discovery, strategy, feedback, PM case studies. Public articles and weekly newsletter; filter career and event noise.",
    "priority": 1
  },
  {
    "id": "original-demand-curve-newsletter",
    "name": "Demand Curve newsletter",
    "url": "https://www.demandcurve.com/newsletter",
    "kind": "web",
    "category": "practitioner",
    "enabled": false,
    "notes": "Optional source from the original registry; disabled to prioritize individual practitioners. Lifecycle campaigns, conversion and growth experiments. Public archive; broader than ICP, use topic filter.",
    "priority": 2
  },
  {
    "id": "original-amplitude-blog",
    "name": "Amplitude blog",
    "url": "https://amplitude.com/blog",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Activation, retention, product benchmarks, analytics, guides, AI. Public; filter B2B SaaS, benchmarks, guides, adoption and AI.",
    "priority": 1
  },
  {
    "id": "original-mixpanel-blog",
    "name": "Mixpanel blog",
    "url": "https://mixpanel.com/blog/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Retention analysis, instrumentation, experimentation, AI analytics. Public; distinguish research and customer examples from promotional posts.",
    "priority": 2
  },
  {
    "id": "original-pendo-blog",
    "name": "Pendo blog",
    "url": "https://www.pendo.io/pendo-blog/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. In-app guidance, adoption measurement, feedback and agent context. Public; close workflow overlap with Userorbit.",
    "priority": 1
  },
  {
    "id": "original-chartmogul-blog",
    "name": "ChartMogul blog",
    "url": "https://chartmogul.com/blog/",
    "kind": "web",
    "category": "research",
    "enabled": false,
    "notes": "Optional source from the original registry; disabled to prioritize individual practitioners. SaaS retention, expansion, PLG benchmarks and activation. Public; outcomes and metrics lens.",
    "priority": 1
  },
  {
    "id": "original-churnzero-blog",
    "name": "ChurnZero blog",
    "url": "https://churnzero.com/blog/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Churn, NRR, digital customer success, onboarding, CS research. Public summaries; some report downloads may be gated.",
    "priority": 1
  },
  {
    "id": "original-intercom-blog",
    "name": "Intercom blog",
    "url": "https://www.intercom.com/blog",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. AI support, help centers, customer communication, user trust research. Public; self-service and AI knowledge workflows.",
    "priority": 2
  },
  {
    "id": "original-zendesk-blog",
    "name": "Zendesk blog",
    "url": "https://www.zendesk.com/blog/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. AI service, knowledge management, customer experience research. Public; filter enterprise service and HR noise.",
    "priority": 2
  },
  {
    "id": "original-gainsight-blog",
    "name": "Gainsight blog",
    "url": "https://www.gainsight.com/blog/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Product adoption, education, tech-touch CS, retention. Public; paginate and verify individual dates.",
    "priority": 2
  },
  {
    "id": "original-document360-blog",
    "name": "Document360 blog",
    "url": "https://document360.com/blog/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Help docs, AI documentation QA, knowledge-base maintenance. Public; filter technical documentation, customer support and AI.",
    "priority": 2
  },
  {
    "id": "original-appcues-blog",
    "name": "Appcues blog",
    "url": "https://www.appcues.com/blog",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Onboarding, activation experiments, lifecycle engagement, AI creation. Public; prioritize experiments and original examples over tool listicles.",
    "priority": 2
  },
  {
    "id": "original-userpilot-blog",
    "name": "Userpilot blog",
    "url": "https://userpilot.com/blog/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Onboarding, feature adoption, activation and product analytics. Public; high SEO volume requires originality filter.",
    "priority": 2
  },
  {
    "id": "original-userguiding-blog",
    "name": "UserGuiding blog",
    "url": "https://userguiding.com/blog",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Product guidance, adoption, AI assistants and analytics. Public; prioritize changes and research over comparisons.",
    "priority": 2
  },
  {
    "id": "original-chameleon-blog",
    "name": "Chameleon blog",
    "url": "https://www.chameleon.io/blog",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Feature discovery, contextual onboarding, personalization, friction. Public; weekly newsletter advertised.",
    "priority": 2
  },
  {
    "id": "original-productboard-blog",
    "name": "Productboard blog",
    "url": "https://www.productboard.com/blog/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Feedback analysis, customer context, prioritization, AI product workflows. Public; strong feedback workflow relevance.",
    "priority": 2
  },
  {
    "id": "original-announcekit-blog",
    "name": "AnnounceKit blog",
    "url": "https://announcekit.app/blog/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Release communication, changelog automation, feature awareness. Public; narrow topical fit.",
    "priority": 2
  },
  {
    "id": "original-appcues-changelog",
    "name": "Appcues changelog",
    "url": "https://feedback.appcues.com/changelog",
    "kind": "rss",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. AI flow creation, surveys, targeting, branching, MCP. Public dated releases.",
    "priority": 1,
    "feedUrl": "https://feedback.appcues.com/api/changelog/feed.rss"
  },
  {
    "id": "original-canny-changelog",
    "discoveryBlockedHosts": ["canny.io"],
    "name": "Canny changelog",
    "url": "https://feedback.canny.io/changelog",
    "kind": "rss",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Feedback capture, segmentation, prioritization, AI integrations. Public releases.",
    "priority": 1,
    "feedUrl": "https://feedback.canny.io/api/changelog/feed.rss"
  },
  {
    "id": "original-userguiding-product-updates",
    "name": "UserGuiding product updates",
    "url": "https://updates.userguiding.com/en",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Guidance, AI assistants, feedback and analytics changes. Public update page; inspect individual dates.",
    "priority": 2
  },
  {
    "id": "original-announcekit-product-updates",
    "name": "AnnounceKit product updates",
    "url": "https://changelog.announcekit.app/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Changelog publishing, notifications, MCP, help-center expansion. Public; validate individual launch dates.",
    "priority": 2
  },
  {
    "id": "original-amplitude-releases",
    "name": "Amplitude releases",
    "url": "https://amplitude.com/releases",
    "kind": "rss",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Guides and surveys, targeting, experiments and analytics changes. Public dated entries; Markdown also advertised at https://amplitude.com/releases.md.",
    "priority": 1,
    "feedUrl": "https://amplitude.com/releases/feed.xml"
  },
  {
    "id": "original-mixpanel-changelogs",
    "name": "Mixpanel changelogs",
    "url": "https://docs.mixpanel.com/changelogs",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Measurement, experimentation, replay and AI capabilities. Public dated changelog; /releases/ redirects here.",
    "priority": 2
  },
  {
    "id": "original-intercom-changes",
    "name": "Intercom changes",
    "url": "https://www.intercom.com/changes/en",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Fin, help center, messaging and support workflow releases. Public dated changelog; pagination needed.",
    "priority": 1
  },
  {
    "id": "original-whats-new-in-pendo",
    "name": "What’s new in Pendo",
    "url": "https://www.pendo.io/new/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Adoption, analytics, guides, agent context and measurement. Public overview; follow full release notes to validate dates and details.",
    "priority": 2
  },
  {
    "id": "original-lennys-community",
    "name": "Lenny’s community",
    "url": "https://www.lennysnewsletter.com/p/community/",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. Practitioner questions, experiments, objections. Paid-subscriber Slack; only public landing page fetched. Discussions require authorized access.",
    "priority": 3
  },
  {
    "id": "original-productled-community",
    "name": "ProductLed community",
    "url": "https://productled.com/community",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. PLG problems, onboarding experiments, operator questions. Free-to-join Slack; only public landing page fetched. Discussions require membership and authorization.",
    "priority": 3
  },
  {
    "id": "original-pma-slack-community",
    "name": "PMA Slack community",
    "url": "https://www.productmarketingalliance.com/join-the-pma-slack-community/",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. Launch and adoption problems, PMM questions, workflows. Join-required Slack; only public landing page fetched. Not public bulk-scanning target.",
    "priority": 3
  },
  {
    "id": "original-pendo-community",
    "name": "Pendo community",
    "url": "https://community.pendo.io/",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. Adoption events, implementation questions, peer practice. Public events and content plus Pendo Connect Slack; private discussions require authorized access.",
    "priority": 3
  },
  {
    "id": "original-producttank",
    "name": "ProductTank",
    "url": "https://www.mindtheproduct.com/producttank/",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. Practitioner talks and emerging product problems. Public meetup directory; free events, recordings vary.",
    "priority": 3
  },
  {
    "id": "original-thought-industries-blog",
    "name": "Thought Industries blog",
    "url": "https://www.thoughtindustries.com/blog/",
    "kind": "web",
    "category": "competitor",
    "enabled": false,
    "notes": "Disabled by default: vendor marketing or competitor release feed. Customer education, knowledge governance, stale content, AI guidance. Public blog and announcements; follow news links as the blog listing can lag launches.",
    "priority": 1
  },
  {
    "id": "original-r-productmanagement",
    "name": "r/ProductManagement",
    "url": "https://www.reddit.com/r/ProductManagement/",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. Product discovery, adoption friction, AI pressure; exclude career and employee onboarding threads. Public search through last30days; this run had incomplete subrequests. Comments are qualitative, not representative benchmarks.",
    "priority": 2
  },
  {
    "id": "original-r-productmarketing",
    "name": "r/ProductMarketing",
    "url": "https://www.reddit.com/r/ProductMarketing/",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. Launch communication, feature awareness, positioning, adoption measurement. Public search through last30days; this run had incomplete subrequests. Comments are qualitative, not representative benchmarks.",
    "priority": 2
  },
  {
    "id": "original-r-saas",
    "name": "r/SaaS",
    "url": "https://www.reddit.com/r/SaaS/",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. Activation and retention experiments; remove self-promotion. Public search through last30days; this run had incomplete subrequests. Comments are qualitative, not representative benchmarks.",
    "priority": 2
  },
  {
    "id": "original-r-customersuccess",
    "name": "r/CustomerSuccess",
    "url": "https://www.reddit.com/r/CustomerSuccess/",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. Customer onboarding, churn, education, knowledge gaps. Public search through last30days; this run had incomplete subrequests. Comments are qualitative, not representative benchmarks.",
    "priority": 2
  },
  {
    "id": "original-hacker-news",
    "name": "Hacker News",
    "url": "https://news.ycombinator.com/",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. First-person product lessons and relevant SaaS customer workflows. Public search returned 23 candidates; high technical and general-business noise. Follow linked primary pages.",
    "priority": 3
  },
  {
    "id": "original-github-public-issues-and-releases",
    "name": "GitHub public issues and releases",
    "url": "https://github.com/",
    "kind": "community",
    "category": "community",
    "enabled": false,
    "notes": "Disabled by default: requires separate public collection support or membership; never collect private discussions. Changes to integrations and AI-assisted customer workflows; scope future runs to named repos. Engine returned 14 candidates using available gh access. Open PRs are proposals, not shipped features.",
    "priority": 3
  },
  {
    "id": "teresa-torres-product-talk",
    "name": "Product Talk",
    "url": "https://www.producttalk.org/",
    "feedUrl": "https://www.producttalk.org/rss/",
    "kind": "rss",
    "category": "practitioner",
    "author": "Teresa Torres",
    "enabled": true,
    "notes": "Continuous discovery, customer interviews, assumption testing, and evidence from product teams. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "marty-cagan-svpg",
    "name": "Silicon Valley Product Group",
    "url": "https://www.svpg.com/articles/",
    "feedUrl": "https://www.svpg.com/feed/",
    "kind": "rss",
    "category": "practitioner",
    "author": "Marty Cagan and SVPG partners",
    "enabled": true,
    "notes": "Product strategy, product operating model, discovery, and product marketing; ignore workshop promotions. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "julie-zhuo-looking-glass",
    "name": "The Looking Glass",
    "url": "https://lg.substack.com/",
    "feedUrl": "https://lg.substack.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "Julie Zhuo",
    "enabled": true,
    "notes": "First-person product building, design judgment, and product leadership; exclude general career advice. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 2
  },
  {
    "id": "gibson-biddle-ask-gib",
    "name": "Ask Gib",
    "url": "https://askgib.substack.com/",
    "feedUrl": "https://askgib.substack.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "Gibson Biddle",
    "enabled": true,
    "notes": "Product strategy, retention, experiments, and lessons from Netflix and Chegg. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "melissa-perri",
    "name": "Melissa Perri",
    "url": "https://melissaperri.com/blog",
    "feedUrl": "https://melissaperri.com/blog?format=rss",
    "kind": "rss",
    "category": "practitioner",
    "author": "Melissa Perri",
    "enabled": true,
    "notes": "Product strategy, product operations, and outcomes. Low publishing frequency; newest blog entry observed was from 2024. Do not present stale work as new news. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "john-cutler-beautiful-mess",
    "name": "The Beautiful Mess",
    "url": "https://cutlefish.substack.com/",
    "feedUrl": "https://cutlefish.substack.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "John Cutler",
    "enabled": true,
    "notes": "Product decisions, feedback systems, evidence, team habits, and outcomes. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "aakash-gupta-product-growth",
    "name": "Product Growth",
    "url": "https://www.news.aakashg.com/",
    "feedUrl": "https://www.news.aakashg.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "Aakash Gupta",
    "enabled": true,
    "notes": "Product growth deep dives, AI product workflows, and practitioner interviews; reject job-search content and promotional posts. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 2
  },
  {
    "id": "brian-balfour",
    "name": "Brian Balfour",
    "url": "https://blog.brianbalfour.com/",
    "feedUrl": "https://blog.brianbalfour.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "Brian Balfour",
    "enabled": true,
    "notes": "Growth systems, distribution shifts, AI product strategy, and first-hand experiments. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "casey-winters-accidental",
    "name": "Casey Accidental",
    "url": "https://www.caseyaccidental.com/",
    "feedUrl": "https://www.caseyaccidental.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "Casey Winters",
    "enabled": true,
    "notes": "Retention, scaling products, growth loops, and marketplace lessons; prioritize B2B applicability. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "april-dunford-positioning",
    "name": "Positioning with April Dunford",
    "url": "https://aprildunford.substack.com/",
    "feedUrl": "https://aprildunford.substack.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "April Dunford",
    "enabled": true,
    "notes": "B2B positioning, customer value, sales conversations, and product marketing. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "ken-norton-bring-donuts",
    "name": "Bring the Donuts",
    "url": "https://www.bringthedonuts.com/blog/",
    "feedUrl": "https://www.bringthedonuts.com/feed.xml",
    "kind": "rss",
    "category": "practitioner",
    "author": "Ken Norton",
    "enabled": true,
    "notes": "Product craft and decision-making; filter personal coaching and general career content. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 2
  },
  {
    "id": "sachin-rekhi",
    "name": "Sachin Rekhi",
    "url": "https://www.sachinrekhi.com/",
    "feedUrl": "https://www.sachinrekhi.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "Sachin Rekhi",
    "enabled": true,
    "notes": "Product craft, AI workflows, product strategy, and first-person startup lessons. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "wes-kao",
    "name": "Wes Kao’s Newsletter",
    "url": "https://newsletter.weskao.com/",
    "feedUrl": "https://newsletter.weskao.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "Wes Kao",
    "enabled": true,
    "notes": "Communication, customer understanding, and practical leadership; retain only direct product or PMM relevance. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 2
  },
  {
    "id": "shreyas-doshi",
    "name": "Shreyas Free Newsletter",
    "url": "https://shreyasdoshi.substack.com/",
    "feedUrl": "https://shreyasdoshi.substack.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "Shreyas Doshi",
    "enabled": true,
    "notes": "Product judgment, customer value, product strategy, and product leadership. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "itamar-gilad",
    "name": "Itamar Gilad",
    "url": "https://itamargilad.com/",
    "feedUrl": "https://itamargilad.com/feed/",
    "kind": "rss",
    "category": "practitioner",
    "author": "Itamar Gilad",
    "enabled": true,
    "notes": "Evidence-guided product decisions, experiments, discovery, and outcome measurement. Public RSS contents verified 23 October 2026. Use only public content; premium excerpts are not full evidence.",
    "priority": 1
  },
  {
    "id": "lennys-podcast-youtube",
    "name": "Lenny’s Podcast",
    "url": "https://www.youtube.com/channel/UC6t1O76G0jYXOAoYCm153dA",
    "feedUrl": "https://www.youtube.com/feeds/videos.xml?channel_id=UC6t1O76G0jYXOAoYCm153dA",
    "kind": "youtube",
    "category": "youtube",
    "author": "Lenny Rachitsky",
    "enabled": true,
    "notes": "Long-form product and growth interviews. Many clips and Shorts; deduplicate against newsletter episodes and prefer full interviews. Channel identity and Atom video entries verified 23 October 2026. RSS covers only the latest uploads, so first-run 30-day coverage may be partial. Descriptions are not transcripts; use public publisher transcripts or an explicitly configured transcript provider.",
    "priority": 1,
    "channelId": "UC6t1O76G0jYXOAoYCm153dA"
  },
  {
    "id": "mind-product-youtube",
    "name": "Mind the Product — talks and interviews",
    "url": "https://www.youtube.com/channel/UCiT1BmYvOBsEvU9iw0076Sw",
    "feedUrl": "https://www.youtube.com/feeds/videos.xml?channel_id=UCiT1BmYvOBsEvU9iw0076Sw",
    "kind": "youtube",
    "category": "youtube",
    "author": "Mind the Product",
    "enabled": true,
    "notes": "Practitioner talks and interviews on product discovery, strategy, and customer value; filter event promotions and career topics. Channel identity and Atom video entries verified 23 October 2026. RSS covers only the latest uploads, so first-run 30-day coverage may be partial. Descriptions are not transcripts; use public publisher transcripts or an explicitly configured transcript provider.",
    "priority": 1,
    "channelId": "UCiT1BmYvOBsEvU9iw0076Sw"
  },
  {
    "id": "product-talk-youtube",
    "name": "Product Talk — videos",
    "url": "https://www.youtube.com/channel/UCOeQvCDAioiHfcbYnyO99MQ",
    "feedUrl": "https://www.youtube.com/feeds/videos.xml?channel_id=UCOeQvCDAioiHfcbYnyO99MQ",
    "kind": "youtube",
    "category": "youtube",
    "author": "Teresa Torres",
    "enabled": true,
    "notes": "Continuous discovery and practical product interviews, including Just Now Possible. Channel identity and Atom video entries verified 23 October 2026. RSS covers only the latest uploads, so first-run 30-day coverage may be partial. Descriptions are not transcripts; use public publisher transcripts or an explicitly configured transcript provider.",
    "priority": 1,
    "channelId": "UCOeQvCDAioiHfcbYnyO99MQ"
  },
  {
    "id": "melissa-perri-youtube",
    "name": "Product Thinking — Melissa Perri",
    "url": "https://www.youtube.com/channel/UCXs8MCXAX2GIOAzhBCOQP0w",
    "feedUrl": "https://www.youtube.com/feeds/videos.xml?channel_id=UCXs8MCXAX2GIOAzhBCOQP0w",
    "kind": "youtube",
    "category": "youtube",
    "author": "Melissa Perri",
    "enabled": true,
    "notes": "Product leadership interviews and product strategy. Distinguish original published date from feed updated date. Channel identity and Atom video entries verified 23 October 2026. RSS covers only the latest uploads, so first-run 30-day coverage may be partial. Descriptions are not transcripts; use public publisher transcripts or an explicitly configured transcript provider.",
    "priority": 1,
    "channelId": "UCXs8MCXAX2GIOAzhBCOQP0w"
  },
  {
    "id": "april-dunford-youtube",
    "name": "April Dunford — Positioning",
    "url": "https://www.youtube.com/channel/UCucNuc_Myj4xCQN7gUXhH-g",
    "feedUrl": "https://www.youtube.com/feeds/videos.xml?channel_id=UCucNuc_Myj4xCQN7gUXhH-g",
    "kind": "youtube",
    "category": "youtube",
    "author": "April Dunford",
    "enabled": true,
    "notes": "B2B positioning and product marketing advice, with practitioner examples. Channel identity and Atom video entries verified 23 October 2026. RSS covers only the latest uploads, so first-run 30-day coverage may be partial. Descriptions are not transcripts; use public publisher transcripts or an explicitly configured transcript provider.",
    "priority": 1,
    "channelId": "UCucNuc_Myj4xCQN7gUXhH-g"
  },
  {
    "id": "saas-capital-research",
    "name": "SaaS Capital — original research",
    "url": "https://www.saas-capital.com/research/",
    "kind": "web",
    "category": "research",
    "enabled": true,
    "notes": "Public research index verified 23 October 2026. Original private B2B SaaS growth, retention, pricing, and capital efficiency benchmarks. Follow dated research pages; report sample, survey period, and methodology. Skip finance-only content, gated downloads, and undated indexes.",
    "priority": 1
  },
  {
    "id": "benchmarkit-research",
    "name": "Benchmarkit — research reports",
    "url": "https://www.benchmarkit.ai/research-reports",
    "kind": "web",
    "category": "research",
    "enabled": true,
    "notes": "Public report index verified 23 October 2026. Original B2B SaaS and product-growth benchmarks; sponsored research requires method and sample scrutiny. Follow public dated reports; skip gated downloads and undated interactive dashboards.",
    "priority": 2
  },
  {
    "id": "openai-news",
    "name": "OpenAI — official news and adoption",
    "url": "https://openai.com/news/",
    "feedUrl": "https://openai.com/news/rss.xml",
    "kind": "rss",
    "category": "industry",
    "enabled": true,
    "notes": "Public feed entries and publication dates verified 23 October 2026. High cadence, with several dated entries per week. Product capabilities, pricing, agent workflows, and first-party adoption cases. Filter corporate affairs and unrelated science. Treat customer outcomes as vendor-reported and follow original study methods.",
    "priority": 1
  },
  {
    "id": "anthropic-news",
    "name": "Anthropic — official product news",
    "url": "https://www.anthropic.com/news",
    "kind": "web",
    "category": "industry",
    "enabled": true,
    "notes": "Public dated news index verified 23 October 2026; latest entries 22 October. Several updates per week. Prioritize new AI capabilities, agent standards, workflow adoption and pricing changes; skip hiring, offices and public-affairs announcements. Verify original article dates.",
    "priority": 1,
    "articlePathPrefixes": [
      "/news/"
    ],
    "maxDiscoveryLinks": 24
  },
  {
    "id": "anthropic-research",
    "name": "Anthropic — research and AI adoption",
    "url": "https://www.anthropic.com/research",
    "kind": "web",
    "category": "research",
    "enabled": true,
    "notes": "Public dated research index verified 23 October 2026; entries dated 22, 20 and 16 October. Original evaluation, usage and workplace research. Prioritize measured behavior, adoption and workflow limits; filter unrelated biological and mathematical science. Report sample and study limits.",
    "priority": 1,
    "articlePathPrefixes": [
      "/research/"
    ],
    "maxDiscoveryLinks": 20
  },
  {
    "id": "anthropic-engineering",
    "name": "Anthropic — engineering AI agents",
    "url": "https://www.anthropic.com/engineering",
    "kind": "web",
    "category": "research",
    "enabled": true,
    "notes": "Public dated engineering index verified 23 October 2026. Low and irregular cadence: latest entry 13 October, previous 25 May. First-hand agent evaluation, context management, reliability and implementation studies. Preserve caveats; do not describe internal experiments as universal productivity gains.",
    "priority": 2,
    "articlePathPrefixes": [
      "/engineering/",
      "/research/"
    ],
    "maxDiscoveryLinks": 12
  },
  {
    "id": "google-deepmind-research",
    "name": "Google DeepMind — research and models",
    "url": "https://deepmind.google/blog/",
    "feedUrl": "https://deepmind.google/blog/rss.xml",
    "kind": "rss",
    "category": "research",
    "enabled": true,
    "notes": "Public feed entries and publication dates verified 23 October 2026. Several releases and research entries per month; latest 22 October. Agent capabilities, evaluations, multimodal interfaces and model efficiency. Filter unrelated physical-science coverage and deduplicate announcements also covered by Google AI.",
    "priority": 1
  },
  {
    "id": "google-ai-news",
    "name": "Google — AI product announcements",
    "url": "https://blog.google/innovation-and-ai/technology/ai/",
    "feedUrl": "https://blog.google/innovation-and-ai/technology/ai/rss/",
    "kind": "rss",
    "category": "industry",
    "enabled": true,
    "notes": "Public feed entries and publication dates verified 23 October 2026. Canonical feed redirects from the older /technology/ai/rss/ URL. Weekly or irregular cadence; latest 21 October. Product workflow changes, AI adoption research and new interaction patterns. Deduplicate DeepMind announcements and exclude generic promotional recaps.",
    "priority": 1
  },
  {
    "id": "huggingface-blog",
    "name": "Hugging Face — open AI models and workflows",
    "url": "https://huggingface.co/blog",
    "feedUrl": "https://huggingface.co/blog/feed.xml",
    "kind": "rss",
    "category": "industry",
    "enabled": true,
    "notes": "Public feed entries and publication dates verified 23 October 2026. High cadence: multiple entries on 22 and 21 October. Open models, evaluations, on-device deployment, inference costs and practical agent building. Posts include outside organizations; verify authorship and distinguish original measurements from unvalidated model marketing.",
    "priority": 1
  },
  {
    "id": "microsoft-research",
    "name": "Microsoft Research — original studies",
    "url": "https://www.microsoft.com/en-us/research/blog/",
    "feedUrl": "https://www.microsoft.com/en-us/research/feed/",
    "kind": "rss",
    "category": "research",
    "enabled": true,
    "notes": "Public feed entries and publication dates verified 23 October 2026. Several entries per week; latest 22, 21 and 20 October. Human-AI collaboration, evaluations, interactive tools and workflow research. Follow original papers and report study populations; skip unrelated mathematics, recruiting and institutional announcements.",
    "priority": 1
  },
  {
    "id": "github-ai-workflows",
    "name": "GitHub — AI and developer workflows",
    "url": "https://github.blog/ai-and-ml/",
    "kind": "web",
    "category": "industry",
    "enabled": true,
    "notes": "Public index and RSS publication dates verified 23 October 2026; entries 20, 19 and 13 October. Several posts per week. First-hand AI adoption, developer research and product workflow changes. Use scoped index discovery because the full-content RSS feed is unusually large. Filter beginner tutorials, generic SEO and unrelated security announcements.",
    "priority": 1,
    "articlePathPrefixes": [
      "/ai-and-ml/"
    ],
    "maxDiscoveryLinks": 20
  },
  {
    "id": "cloudflare-engineering",
    "name": "Cloudflare — agents and engineering",
    "url": "https://blog.cloudflare.com/",
    "feedUrl": "https://blog.cloudflare.com/rss/",
    "kind": "rss",
    "category": "industry",
    "enabled": true,
    "notes": "Public feed entries and publication dates verified 23 October 2026. High cadence: daily or several entries per week; latest 22 October. Practical agent infrastructure, AI discovery, inference economics and customer implementation cases. Exclude routine WAF, network, compliance and security bulletins without a product or growth implication.",
    "priority": 2
  },
  {
    "id": "stripe-product-research",
    "name": "Stripe — SaaS economics and product cases",
    "url": "https://stripe.com/blog",
    "feedUrl": "https://stripe.com/blog/feed.rss",
    "kind": "rss",
    "category": "industry",
    "enabled": true,
    "notes": "Public feed entries and publication dates verified 23 October 2026. Several posts per week; latest 22 October, with SaaS research 19 October and AI monetization 13 October. Prioritize original SaaS surveys, pricing, conversion and AI business models; exclude routine finance product announcements without transferable lessons.",
    "priority": 1
  },
  {
    "id": "nielsen-norman-research",
    "name": "Nielsen Norman Group — UX research",
    "url": "https://www.nngroup.com/articles/",
    "feedUrl": "https://www.nngroup.com/feed/rss/",
    "kind": "rss",
    "category": "research",
    "enabled": true,
    "notes": "Public feed entries and publication dates verified 23 October 2026. Weekly batches; entries 16 and 9 October. Original usability studies, AI interaction design, user understanding and research methods. Distinguish empirical studies from reference glossaries and opinion; preserve participant counts and limitations.",
    "priority": 1
  },
  {
    "id": "ethan-mollick-one-useful-thing",
    "name": "One Useful Thing — Ethan Mollick",
    "url": "https://www.oneusefulthing.org/",
    "feedUrl": "https://www.oneusefulthing.org/feed",
    "kind": "rss",
    "category": "practitioner",
    "enabled": true,
    "notes": "Public feed entries and publication dates verified 23 October 2026. Irregular cadence, roughly every few weeks in the recent sample: 20 October, 1 October and 18 September. First-hand AI workflow experiments and research interpretation. Follow linked original papers; separate demonstrations and personal experience from controlled study results.",
    "priority": 1,
    "author": "Ethan Mollick"
  },
  {
    "id": "spotify-engineering",
    "name": "Spotify Engineering — experiments and AI",
    "url": "https://engineering.atspotify.com/",
    "feedUrl": "https://engineering.atspotify.com/feed",
    "kind": "rss",
    "category": "research",
    "enabled": true,
    "notes": "Public feed entries and publication dates verified 23 October 2026. Several entries per month; latest 16 and 8 October, with experimentation and engineering lessons in September. First-hand measurement, personalization, experiments and AI development studies. Skip infrastructure-only posts without a transferable product decision.",
    "priority": 2
  },
  {
    "id": "airbnb-engineering",
    "name": "Airbnb — engineering and data science",
    "url": "https://airbnb.tech/",
    "feedUrl": "https://airbnb.tech/feed/",
    "kind": "rss",
    "category": "research",
    "enabled": true,
    "notes": "Public feed entries and publication dates verified 23 October 2026. Roughly weekly recent cadence: 13 and 6 October, 29 and 23 September. First-hand experimentation, search, personalization and AI product implementation. Require a clear transferable product or measurement lesson; avoid treating marketplace outcomes as B2B benchmarks.",
    "priority": 2
  },
  {
    "id": "netflix-engineering",
    "name": "Netflix TechBlog — experiments and personalization",
    "url": "https://netflixtechblog.com/",
    "feedUrl": "https://netflixtechblog.com/feed",
    "kind": "rss",
    "category": "research",
    "enabled": true,
    "notes": "Public feed entries and publication dates verified 23 October 2026. Several technical posts per month; entries 22, 16 and 14 October. Primary experiments, recommendation measurement and AI interface cases. Prioritize adoption and experimentation lessons; filter storage, infrastructure and systems posts with no product implication.",
    "priority": 2
  },
  {
    "id": "slack-engineering",
    "name": "Slack — engineering AI workflows",
    "url": "https://slack.engineering/",
    "feedUrl": "https://slack.engineering/feed/",
    "kind": "rss",
    "category": "research",
    "enabled": true,
    "notes": "Public feed entries and publication dates verified 23 October 2026. Low recent cadence: latest 14 July, preceded by June and May posts. Primary agent-context, AI reliability and workplace-product studies. Useful for discovery backfills and future updates, not a dependable daily-news source; filter infrastructure-only posts.",
    "priority": 2
  },
  {
    "id": "stanford-hai-research",
    "name": "Stanford HAI — AI adoption research",
    "url": "https://hai.stanford.edu/news",
    "kind": "web",
    "category": "research",
    "enabled": true,
    "notes": "Public institutional news index verified 23 October 2026; research coverage dated 21 and 7 October. Weekly or irregular cadence. Human-AI interaction, workplace adoption and original economic studies. Follow linked papers, verify the full publication year on each article, and exclude event, personnel and third-party media coverage.",
    "priority": 2,
    "articlePathPrefixes": [
      "/news/"
    ],
    "maxDiscoveryLinks": 20
  },
  {
    "id": "simon-willison",
    "name": "Simon Willison — AI experiments and discovery",
    "url": "https://simonwillison.net/",
    "feedUrl": "https://simonwillison.net/atom/everything/",
    "kind": "rss",
    "category": "practitioner",
    "author": "Simon Willison",
    "enabled": true,
    "notes": "Public Atom entries verified 23 October 2026; multiple entries dated 22 October. High cadence: daily experiments and primary-source discovery on AI models, agents, evaluation and tool design. Distinguish first-hand tests from quoted or linked commentary, follow original sources, and filter personal interests without a useful product implication.",
    "priority": 1
  },
  {
    "id": "addy-osmani-elevate",
    "name": "Elevate — Addy Osmani",
    "url": "https://addyo.substack.com/",
    "feedUrl": "https://addyo.substack.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "Addy Osmani",
    "enabled": true,
    "notes": "Public RSS verified 23 October 2026; latest visible issue dated 14 October. Regular but not daily publication on agent engineering, verification and effective AI workflows. Attribute experiments, separate opinion from measured results, and filter generic leadership or career material.",
    "priority": 1
  },
  {
    "id": "alexey-on-data",
    "name": "Alexey On Data — AI Shipping Blog",
    "url": "https://aishippingblog.com/",
    "feedUrl": "https://aishippingblog.com/feed",
    "kind": "rss",
    "category": "practitioner",
    "author": "Alexey Grigorev",
    "enabled": true,
    "notes": "Public RSS verified 23 October 2026; latest issue 20 October. Canonical domain verified from the redirect of alexeyondata.substack.com/feed. Several recent issues per month. First-hand AI system experiments, operational postmortems and agent workflows; filter course promotions and require practical transferable lessons.",
    "priority": 1
  },
  {
    "id": "tim-herbig-product-practice",
    "name": "Product Practice — Tim Herbig",
    "url": "https://newsletter.herbig.co/",
    "kind": "web",
    "category": "practitioner",
    "author": "Tim Herbig",
    "enabled": true,
    "notes": "Public dated newsletter archive verified 23 October 2026; issues dated 23, 11 and 5 October. Roughly weekly product strategy, discovery, evidence and practical AI workflows. Discover public /posts/ articles: newsletter feed endpoints returned 404, while herbig.co/feed is a separate infrequent blog. Filter workshop promotions and follow original studies.",
    "priority": 1,
    "articlePathPrefixes": [
      "/posts/"
    ],
    "maxDiscoveryLinks": 20
  },
  {
    "id": "latent-space",
    "name": "Latent Space — original AI interviews and discovery",
    "url": "https://latent.space",
    "feedUrl": "https://latent.space/feed",
    "kind": "rss",
    "category": "practitioner",
    "enabled": true,
    "notes": "Public RSS verified 23 October 2026. High cadence: three entries fell within the fixed audit window, including two original interviews on 22 October and one AINews briefing on 23 October. Prefer first-hand interviews and engineering experiments. AINews is secondary curation: follow primary links, preserve original dates, and deduplicate underlying stories; do not treat a fresh roundup as newly published research. Public feed text may be an excerpt, not a complete interview transcript.",
    "priority": 1
  },
  {
    "id": "discovery-ai-workflows",
    "name": "Discovery — AI product workflows and production experiments",
    "url": "https://treg.to",
    "kind": "search",
    "discoverySearchType": "news",
    "category": "research",
    "enabled": true,
    "notes": "Three topic queries: AI workflow capabilities, AI product pricing changes, and production agent experiments. Discovery uses the free-only provider; no paid fallback. Search results are leads, never evidence or verified publication dates. Fetch the original public page and verify its original date within the requested window, source identity, and readable evidence before ranking. Preserve publisher claims and limitations; exclude thin promotion and job listings.",
    "priority": 1,
    "discoveryQueries": [
      "AI workplace productivity study -jobs -careers",
      "AI agents evaluation production -jobs -careers",
      "AI product API launch workflow pricing -jobs -careers"
    ]
  },
  {
    "id": "discovery-product-research",
    "name": "Discovery — human-AI studies and original product evidence",
    "url": "https://treg.to",
    "kind": "search",
    "category": "research",
    "enabled": true,
    "notes": "Three topic queries: new human-AI agent papers, workplace collaboration studies, and university field research. Discovery uses the free-only provider; no paid fallback. Verify original publication dates and readable primary evidence before ranking; search-result dates and updated timestamps do not establish freshness. Record study populations, metric definitions and limitations, and reject unsupported summaries or generic SEO.",
    "priority": 1,
    "discoveryQueries": [
      "site:arxiv.org human AI agents evaluation productivity -jobs -careers",
      "AI human collaboration experiment study workplace productivity -jobs -careers",
      "AI field experiment workplace productivity research university -jobs -careers"
    ]
  },
  {
    "id": "discovery-practitioner-experiments",
    "name": "Discovery — first-hand practitioner experiments",
    "url": "https://treg.to",
    "kind": "search",
    "category": "practitioner",
    "enabled": true,
    "notes": "Two topic queries: production agent case studies and first-hand AI coding workflow experiments. Discovery uses the free-only provider; no paid fallback. Follow the original author, verify the original publication date within the requested window, and collect public supporting text before ranking. Keep self-reports distinct from controlled evidence, skip recycled commentary and course promotions, and never access a private discussion or paid continuation.",
    "priority": 1,
    "discoveryQueries": [
      "AI agents production lessons experiment evaluation engineering case study -jobs -careers",
      "AI coding experiment what I learned engineering workflow -jobs -careers"
    ]
  },
  {
    "id": "claire-vo-how-i-ai",
    "name": "How I AI — Claire Vo",
    "url": "https://www.chatprd.ai/how-i-ai",
    "kind": "web",
    "category": "practitioner",
    "author": "Claire Vo",
    "enabled": true,
    "priority": 1,
    "articlePathPrefixes": [
      "/how-i-ai/"
    ],
    "maxDiscoveryLinks": 14,
    "notes": "Public written episode notes and screen-shared practitioner workflows verified 26 October 2026. Prefer product feedback, prototyping, evaluation, customer support and operational experiments; filter personal hobbies, sponsorship and generic model hype. Written notes are not verbatim transcripts. Attribute first-hand demonstrations and self-reported outcomes; do not infer controlled productivity gains. Preserve original publication dates; the undated workflows directory is ineligible."
  },
  {
    "id": "product-experience-episodes",
    "name": "The Product Experience — practitioner interviews",
    "url": "https://www.mindtheproduct.com/podcasts/the-product-experience/",
    "kind": "web",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "maxDiscoveryLinks": 12,
    "notes": "Narrow weekly episode index verified 26 October 2026, traced from successful social clips. Collect public episode text: some pages contain transcripts, others only key takeaways and chapters. Use only the readable portion, not unseen audio or a claimed complete transcript; article collection is bounded to 14000 characters. Prefer first-hand discovery, activation, retention, positioning and AI-product case studies; filter career, event and training promotion. Deduplicate clips and YouTube uploads against the same interview; preserve original episode dates. The broad Mind the Product blog remains opt-in."
  },
  {
    "id": "parlance-labs-evaluations",
    "name": "Parlance Labs — original AI evaluation experiments",
    "url": "https://parlance-labs.com/blog/",
    "kind": "web",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "articlePathPrefixes": [
      "/blog/posts/"
    ],
    "maxDiscoveryLinks": 12,
    "notes": "Original experiments by evaluation practitioners, verified 26 October 2026. The public automated-evals comparison reports 100 production traces, 39 human-labelled failures and explicit single-dataset limits; do not generalize vendor rankings or causal product gains. Sparse publication cadence; the verified July article is historical, not a new daily finding. This collector follows only same-host articles; author posts linked on hamel.dev, sh-reya.com or other hosts require separate primary-source verification and are not silently collected. Exclude course promotion and preserve original dates."
  },
  {
    "id": "lovable-primary-product",
    "name": "Lovable — product workflows and release decisions",
    "url": "https://lovable.dev/blog",
    "feedUrl": "https://lovable.dev/blog/rss.xml",
    "kind": "rss",
    "category": "industry",
    "enabled": true,
    "priority": 1,
    "notes": "Verified 26 October 2026 from successful practitioner source chains. Public dated RSS includes the exact chat-for-free pricing origin; feed metadata needs article hydration, verified with current-week full public text. Prefer concrete product decisions, customer workflows, pricing incentives and substantive capability changes. Attribute vendor claims; do not infer independent outcome proof, repeat promotional release copy or treat a creator’s social commentary as included in this feed."
  },
  {
    "id": "cursor-product-practice",
    "name": "Cursor — original product and AI workflow decisions",
    "url": "https://cursor.com/blog",
    "kind": "web",
    "category": "industry",
    "enabled": true,
    "priority": 2,
    "articlePathPrefixes": [
      "/blog/"
    ],
    "maxDiscoveryLinks": 12,
    "notes": "Public bounded blog discovery verified 26 October 2026: twelve readable dated articles including the exact router-design origin cited in the benchmark. RSS endpoint serves HTML and is not used. Prefer inspectable product, UX, reliability, pricing or team-workflow decisions; exclude infrastructure details with no practical audience implication. Publisher performance claims remain attributed, not independent benchmarks. Index depth is bounded; monitoring does not backfill the whole archive."
  },
  {
    "id": "shopify-ai-product-cases",
    "name": "Shopify Engineering — first-hand AI product cases",
    "url": "https://shopify.engineering/topics/ai-machine-learning",
    "kind": "web",
    "category": "practitioner",
    "enabled": true,
    "priority": 2,
    "maxDiscoveryLinks": 12,
    "notes": "Narrow AI/machine-learning topic index verified 26 October 2026: twelve readable articles, eleven dated, including the exact Shopify Flow fine-tuning case cited by practitioners. Focus on product evaluation, user tasks, feedback and deployment tradeoffs; skip low-level infrastructure without a useful product/growth implication. Original author accounts require sample, benchmark and self-report limitations. Undated items stay outside freshness windows."
  },
  {
    "id": "paywall-index-research",
    "name": "The Paywall Index — subscription experiments and benchmarks",
    "url": "https://thepaywallindex.substack.com/archive",
    "feedUrl": "https://thepaywallindex.substack.com/feed",
    "kind": "rss",
    "category": "research",
    "enabled": true,
    "priority": 2,
    "notes": "Public RSS verified 26 October 2026: three dated full-text analyses including the exact 10000-app trial-duration study cited by a selected practitioner. This is mobile subscription/platform data, not B2B SaaS causal evidence. Preserve cohort, platform, geography, period and confounding; use only when a defensible trial/pricing mechanism transfers to the publishing audience. Never promise conversion gains from copying a trial length."
  },
  {
    "id": "saastr-practitioner-cases",
    "name": "SaaStr — practitioner operating cases",
    "url": "https://www.saastr.com/",
    "feedUrl": "https://www.saastr.com/feed/",
    "kind": "rss",
    "category": "practitioner",
    "enabled": true,
    "priority": 2,
    "notes": "Public dated RSS verified 26 October 2026: ten readable current articles. Source appears behind selected founder/operator content; the recent feed does not contain every historical benchmark URL. Prefer specific attributed practitioner cases about SaaS growth, customer value, pricing, team operations and useful AI workflows. Reject event advertising, generic hype and second-hand claims without supporting detail. Distinguish an opinion or illustrative mechanism from measured performance and preserve original publication dates."
  },
  {
    "id": "wynter-original-research",
    "name": "Wynter — original B2B buyer research",
    "url": "https://wynter.com/blog-category/research",
    "kind": "web",
    "category": "research",
    "enabled": true,
    "priority": 1,
    "articlePathPrefixes": [
      "/post/"
    ],
    "maxDiscoveryLinks": 12,
    "notes": "Narrow original research index verified 26 October 2026. Publisher-specific original byline dates now supported: eight readable reports, seven dated; latest available report is historical August12, not fresh because its title says Q3. Use disclosed sample, population, survey timing and self-report limitations. Vendor-selected panels and correlations are not representative causal proof. General SEO blog excluded; missing original dates stay ineligible."
  },
  {
    "id": "measuringu-original-research",
    "name": "MeasuringU — empirical UX and AI research",
    "url": "https://measuringu.com/blogs/",
    "kind": "web",
    "category": "research",
    "enabled": true,
    "priority": 1,
    "maxDiscoveryLinks": 12,
    "notes": "Public original research index verified 26 October 2026: twelve readable dated articles with original publisher bylines. Prefer usability measurement, AI-assisted research, synthesis and product evaluation experiments with inspectable methods. Preserve study population, task definitions, sample and uncertainty; avoid treating synthetic-user results as equivalent to real users. Use article discovery rather than the Feedburner XML endpoint, which fails existing XML validation. Full pages may exceed stored evidence bounds; do not claim unseen sections were read."
  },
  {
    "id": "discovery-hackernews-public-signals",
    "name": "Discovery — public Hacker News product signals",
    "url": "https://hn.algolia.com",
    "kind": "search",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "discoveryProvider": "hackernews",
    "discoveryQueries": [
      "SaaS",
      "AI agents",
      "product"
    ],
    "notes": "Public unauthenticated Hacker News Search API, verified 26 October 2026. Three bounded topic queries discover linked public essays, product launches, experiments and research without a social account or paid service. HN submission time, ranking and snippets are discovery leads only, never source publication dates, popularity evidence or proof of quality. Fetch the linked original article and verify its own publication date and readable text before ranking. Skip jobs, social-only links, thin promotions, inaccessible pages and configured competitor feeds. free-only; no paid fallback. A newly submitted old essay is not fresh research; preserve original dates."
  },
  {
    "id": "linear-product-craft",
    "name": "Linear — product craft and workflow essays",
    "url": "https://linear.app/now",
    "feedUrl": "https://linear.app/rss/now.xml",
    "kind": "rss",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "notes": "Official RSS verified 26 October 2026: sixty dated entries, fifty-nine with substantial public text. Public product-craft essays and workflow decisions precede several successful practitioner discussions. Prefer concrete design judgment, feedback, project/product communication and AI-workflow lessons. Preserve original dates and attribute first-party product claims. Use RSS rather than the web index, whose visible dates are not reliably parsed."
  },
  {
    "id": "fyxer-product-changelog",
    "name": "Fyxer — public product changelog",
    "url": "https://www.fyxer.com/changelog",
    "kind": "web",
    "category": "industry",
    "enabled": true,
    "priority": 2,
    "maxDiscoveryLinks": 12,
    "notes": "Public changelog verified 26 October 2026: ten dated entries including dashboard and inbox-agent changes preceding selected product-practitioner commentary. Seven entries have substantial readable body text; shorter entries still need enough source evidence before ranking. Prefer concrete onboarding, permission, task-completion and collaboration changes. Do not import testimonial, promised productivity or marketing claims as independent results. Preserve each release date and actual availability."
  },
  {
    "id": "every-chain-of-thought",
    "name": "Every — original AI operating essays",
    "url": "https://every.to/chain-of-thought",
    "kind": "web",
    "category": "practitioner",
    "enabled": true,
    "priority": 2,
    "articlePathPrefixes": [
      "/chain-of-thought/"
    ],
    "maxDiscoveryLinks": 12,
    "notes": "Public essay index verified 26 October 2026: six readable dated articles, including Dan Shipper’s original Two-slice Team source. Observed index publication dates were January–July; these are historical inputs, not new daily stories. Advertised feed endpoint returned404, so use bounded web discovery. Prefer original practitioner reasoning and operating examples, with attributed limits; paid continuations and unseen sections are not evidence. Updated times do not replace original publication dates."
  },
  {
    "id": "posthog-original-product-practice",
    "name": "PostHog — original operating and product practice",
    "url": "https://posthog.com/blog",
    "kind": "web",
    "category": "practitioner",
    "enabled": true,
    "priority": 2,
    "articlePathPrefixes": [
      "/blog/"
    ],
    "maxDiscoveryLinks": 12,
    "notes": "Public original-author blog verified 26 October 2026 after publisher-specific original byline support: ten readable dated articles. First-hand marketing experiments, ownership, hiring and product-team tradeoffs are useful when a supported mechanism or considered observation fits a personal profile. Exclude generic competitor advertising and unsupported success promises. First-party figures are attributed, not causal proof. RSS exceeds the collector’s safe body limit and is not used."
  },
  {
    "id": "lyssna-research-workflows",
    "name": "Lyssna — public research workflows and releases",
    "url": "https://www.lyssna.com/blog/",
    "kind": "web",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "articlePathPrefixes": [
      "/blog/"
    ],
    "maxDiscoveryLinks": 12,
    "notes": "Public article index verified 26 October 2026: ten readable dated articles after excluding category/author archives and pagination before the link cap. Original MCP research connection and research-synthesis materials supply public signals behind selected practitioner posts. Prefer inspectable research workflows, study methods and concrete release capabilities; exclude generic SEO and unverified tool-performance promises. Preserve original JSON-LD publication time: the MCP article was first published29July, despite a later visible September update. Living skill documentation is supporting reference, not a newly dated research article."
  },
  {
    "id": "productled-original-podcast",
    "name": "ProductLed — original practitioner podcast notes",
    "url": "https://pod.co/product-led-podcast",
    "feedUrl": "https://feed.pod.co/product-led-podcast",
    "kind": "rss",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "author": "Wes Bush and guests",
    "notes": "Public publisher-distributed RSS verified 26 October 2026: sixty dated episodes, including the exact September8 Day27 AI-product case preceding a selected social post. Public written show notes hydrate to3142characters for that example. Use only the written notes actually collected; a podcast description is not a transcript or proof the audio was heard. Prefer inspectable product-led activation, customer learning, pricing and first-hand build experiments; attribute anecdotal outcomes and preserve episode publication dates."
  },
  {
    "id": "lyssna-ai-research-guide",
    "name": "Lyssna — AI research methods guide",
    "url": "https://www.lyssna.com/guides/ai-in-user-research-guide/",
    "kind": "web",
    "category": "practitioner",
    "enabled": true,
    "priority": 2,
    "articlePathPrefixes": [
      "/guides/ai-in-user-research-guide/"
    ],
    "maxDiscoveryLinks": 12,
    "notes": "Public guide hub verified 26 October 2026: six dated readable chapters, including source-grounded research synthesis, contradictory evidence and study-age/sample checks behind selected practitioner advice. These are method recommendations and implementation guidance, not proof of promoted-tool effectiveness. Original September publication dates govern freshness; later revision text may differ from what was present at publication. Living reports linked from chapters keep their own access/date limitations."
  },
  {
    "id": "jeff-gothelf-original",
    "name": "Jeff Gothelf — product discovery and AI decision quality",
    "url": "https://jeffgothelf.com/blog/",
    "feedUrl": "https://jeffgothelf.com/feed/",
    "kind": "rss",
    "category": "practitioner",
    "author": "Jeff Gothelf",
    "enabled": true,
    "priority": 1,
    "notes": "Original practitioner RSS verified 26 October 2026: ten dated readable essays, including current product-team decision, customer discovery and AI evaluation work. Prefer concrete outcome definitions, learning methods and inspectable product decisions. An author's interpretation or first-hand anecdote is attributed evidence, not a general causal finding. Preserve original dates; a social repost does not make an old essay fresh. Public feed access does not imply access to private newsletter editions."
  },
  {
    "id": "aws-ai-development-original",
    "name": "AWS — original AI development methods and cases",
    "url": "https://aws.amazon.com/blogs/devops/",
    "feedUrl": "https://aws.amazon.com/blogs/devops/feed/",
    "backfillUrls": ["https://aws.amazon.com/blogs/devops/ai-driven-development-life-cycle/"],
    "kind": "rss",
    "category": "practitioner",
    "enabled": true,
    "priority": 2,
    "notes": "Official DevOps RSS verified 26 October 2026: twenty dated readable articles. Original source for the named AI-DLC method appearing in practitioner research; its July2025 publication remains historical. Select product-team decision workflows, review boundaries, evaluation and concrete delivery cases; reject unrelated infrastructure tutorials and generic vendor announcements. Attribute vendor-reported results and distinguish current released workflows from old methodology or proposals."
  },
  {
    "id": "rehearsals-original-updates",
    "name": "Rehearsals — original simulation research and releases",
    "url": "https://www.tryrehearsals.com/updates",
    "kind": "web",
    "category": "research",
    "enabled": true,
    "priority": 2,
    "articlePathPrefixes": ["/updates/"],
    "notes": "Scoped first-party updates verified 26 October 2026: seven dated readable research, methodology and product notes behind public discussion of AI twins and simulation. Observed latest dated article was September16, so this is not a promise of fresh daily yield. Preserve original dates, population definitions, validation method and vendor self-report caveats. A simulated panel is not interchangeable with observed customers; commercial fidelity numbers require their exact evaluation conditions."
  },
  {
    "id": "swan-original-changelog",
    "name": "Swan — original context and agent workflow releases",
    "url": "https://www.getswan.com/changelog",
    "backfillUrls": ["https://www.getswan.com/changelog/the-brain"],
    "kind": "web",
    "category": "industry",
    "enabled": true,
    "priority": 2,
    "articlePathPrefixes": ["/changelog/"],
    "notes": "Narrow public changelog verified 26 October 2026. Original October14 Brain release precedes selected practitioner discussion of company/account context, call notes and agent workflows. Read only specific released capabilities and availability with the article's matching original JSON-LD publication date. The earlier undated WebPage graph entry must not mask its dated BlogPosting. Changelog facts do not independently validate higher conversion, pipeline impact or creator attribution; broad comparison and SEO marketing feeds remain excluded."
  },
  {
    "id": "gartner-original-public-research",
    "name": "Gartner — original public research releases",
    "url": "https://www.gartner.com/en/newsroom",
    "feedUrl": "https://www.gartner.com/en/newsroom/rss",
    "backfillUrls": ["https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027"],
    "kind": "rss",
    "category": "research",
    "enabled": true,
    "priority": 2,
    "notes": "Official public research release RSS verified during upstream-source repair: twenty-five dated summaries. Original dated public pages can hydrate to substantial text, including the June2025 agent-project cancellation forecast. Feed and article initially returned HTTP403 and succeeded on a later probe; access can vary and failures must remain visible. Hydrate short excerpts before screening; public press-release evidence does not imply access to gated reports or unseen methods. Keep forecasts distinct from observed outcomes, retain sample/method limitations, and preserve original dates rather than later social discussion dates. Filter unrelated enterprise IT predictions against the actual ICP."
  },
  {
    "id": "pew-ai-original-research",
    "name": "Pew — primary AI use and search studies",
    "url": "https://www.pewresearch.org/topic/internet-technology/emerging-technology/artificial-intelligence/",
    "kind": "web",
    "category": "research",
    "enabled": true,
    "priority": 1,
    "articlePathPrefixes": [
      "/short-reads/",
      "/internet/",
      "/data-labs/"
    ],
    "backfillUrls": [
      "https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/"
    ],
    "notes": "Original Pew AI/search-use and survey-method research only. Keep the scoped public topic index and exact historical AI-summary backfill. Prefer the publisher-advertised public WordPress JSON representation for each canonical article, verified by exact URL, published status and AI category. Preserve original date_gmt, never modified time. Worker access can differ from local probes; archive records and per-page failures do not establish readable source coverage. Strip share/widget metadata before accepting source text. Preserve studied population, period, denominators, selection and measurement limitations. The 22 July 2025 AI-overview study observes 900 U.S. adults during March 2025; 1% is clicks on summary-source links per visits with a summary, not all search traffic. Do not infer causal SEO decline, business-buyer behavior, or AI accuracy from this consumer study. Retain only practical product/growth/customer-research implications; exclude partisan/election, geopolitical, labor and general AI-opinion news without specific ICP relevance. Public notes/abstracts are not full report evidence. Index-first-page discovery does not promise complete historical site enumeration."
  },
  {
    "id": "foldspace-product-workflows",
    "name": "Foldspace — product onboarding workflows",
    "url": "https://foldspace.ai/blog",
    "kind": "web",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "notes": "Discover substantive public original articles from this publisher index. Preserve original dates and access limits; older articles are evergreen references, not new releases. Index coverage is limited to actually returned links, not all publisher history.",
    "articlePathPrefixes": [
      "/blog/"
    ]
  },
  {
    "id": "itamar-original-resource-index",
    "name": "Itamar Gilad — original product resources",
    "url": "https://itamargilad.com/",
    "kind": "web",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "notes": "Discover substantive public original articles from this publisher index. Preserve original dates and access limits; older articles are evergreen references, not new releases. Index coverage is limited to actually returned links, not all publisher history."
  },
  {
    "id": "april-original-positioning-index",
    "name": "April Dunford — original positioning essays",
    "url": "https://www.aprildunford.com/category/positioning",
    "kind": "web",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "notes": "Discover substantive public original articles from this publisher index. Preserve original dates and access limits; older articles are evergreen references, not new releases. Index coverage is limited to actually returned links, not all publisher history.",
    "articlePathPrefixes": [
      "/post/"
    ]
  },
  {
    "id": "hiten-original-product-observations",
    "name": "Hiten Shah — original product observations",
    "url": "https://hitenism.com/",
    "kind": "web",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "notes": "Discover substantive public original articles from this publisher index. Preserve original dates and access limits; older articles are evergreen references, not new releases. Index coverage is limited to actually returned links, not all publisher history."
  },
  {
    "id": "lyssna-ai-skills-reference",
    "name": "Lyssna — public research skills library",
    "url": "https://www.lyssna.com/ai-skills/",
    "kind": "web",
    "pageMode": "article",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "notes": "Monitor this public first-party reference body. Preserve its original publication date when explicit; otherwise label it an undated reference with actual first observation. Attribute product and practitioner claims; do not treat a crawl as a launch, infer unreported outcomes, or assume historical discovery."
  },
  {
    "id": "wynter-ai-positioning-reference",
    "name": "Wynter — public AI positioning workshop outline",
    "url": "https://wynter.com/ai-positioning-workshop",
    "kind": "web",
    "pageMode": "article",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "notes": "Monitor this public first-party reference body. Preserve its original publication date when explicit; otherwise label it an undated reference with actual first observation. Attribute product and practitioner claims; do not treat a crawl as a launch, infer unreported outcomes, or assume historical discovery."
  },
  {
    "id": "itamar-impact-reference",
    "name": "Itamar Gilad — impact matrix reference",
    "url": "https://itamargilad.com/impact/",
    "kind": "web",
    "pageMode": "article",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "notes": "Monitor this public first-party reference body. Preserve its original publication date when explicit; otherwise label it an undated reference with actual first observation. Attribute product and practitioner claims; do not treat a crawl as a launch, infer unreported outcomes, or assume historical discovery."
  },
  {
    "id": "product-manager-toolkit-reference",
    "name": "Product Manager Toolkit — public methods and skills",
    "url": "https://github.com/imohammadfaraz/product-manager-toolkit",
    "kind": "web",
    "pageMode": "article",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "notes": "Monitor this public first-party reference body. Preserve its original publication date when explicit; otherwise label it an undated reference with actual first observation. Attribute product and practitioner claims; do not treat a crawl as a launch, infer unreported outcomes, or assume historical discovery."
  },
  {
    "id": "marketing-skills-reference",
    "name": "Marketing Skills — public agent workflows",
    "url": "https://github.com/coreyhaines31/marketingskills",
    "kind": "web",
    "pageMode": "article",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "notes": "Monitor this public first-party reference body. Preserve its original publication date when explicit; otherwise label it an undated reference with actual first observation. Attribute product and practitioner claims; do not treat a crawl as a launch, infer unreported outcomes, or assume historical discovery."
  },
  {
    "id": "ownable-idea-reference",
    "name": "UNIGNORABLE — ownable idea framework",
    "url": "https://beunignorable.com/ownable-idea/",
    "kind": "web",
    "pageMode": "article",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "notes": "Monitor this public first-party reference body. Preserve its original publication date when explicit; otherwise label it an undated reference with actual first observation. Attribute product and practitioner claims; do not treat a crawl as a launch, infer unreported outcomes, or assume historical discovery."
  },
  {
    "id": "swan-public-context-workflows",
    "name": "Swan — public context and sales workflow examples",
    "url": "https://www.getswan.com/",
    "kind": "web",
    "pageMode": "article",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "notes": "Monitor this public first-party reference body. Preserve its original publication date when explicit; otherwise label it an undated reference with actual first observation. Attribute product and practitioner claims; do not treat a crawl as a launch, infer unreported outcomes, or assume historical discovery."
  },
  {
    "id": "outreach2day-product-economics",
    "name": "Outreach2day — public capability and pricing reference",
    "url": "https://outreach2day.com/pricing",
    "kind": "web",
    "pageMode": "article",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "notes": "Monitor this public first-party reference body. Preserve its original publication date when explicit; otherwise label it an undated reference with actual first observation. Attribute product and practitioner claims; do not treat a crawl as a launch, infer unreported outcomes, or assume historical discovery."
  },
  {
    "id": "google-analytics-predictive-audiences",
    "name": "Google Analytics — predictive audience definitions",
    "url": "https://support.google.com/analytics/answer/9805833?hl=en",
    "kind": "web",
    "pageMode": "article",
    "category": "research",
    "enabled": true,
    "priority": 1,
    "notes": "Monitor this public first-party reference body. Preserve its original publication date when explicit; otherwise label it an undated reference with actual first observation. Attribute product and practitioner claims; do not treat a crawl as a launch, infer unreported outcomes, or assume historical discovery."
  },
  {
    "id": "google-ads-dynamic-prospecting",
    "name": "Google Ads — dynamic prospecting mechanics",
    "url": "https://support.google.com/google-ads/answer/2497941?hl=en",
    "kind": "web",
    "pageMode": "article",
    "category": "research",
    "enabled": true,
    "priority": 1,
    "notes": "Monitor this public first-party reference body. Preserve its original publication date when explicit; otherwise label it an undated reference with actual first observation. Attribute product and practitioner claims; do not treat a crawl as a launch, infer unreported outcomes, or assume historical discovery."
  },
  {
    "id": "google-demand-generation-reference",
    "name": "Google Ads — Demand Gen capability reference",
    "url": "https://support.google.com/google-ads/answer/14587068?hl=en",
    "kind": "web",
    "pageMode": "article",
    "category": "research",
    "enabled": true,
    "priority": 1,
    "notes": "Monitor this public first-party reference body. Preserve its original publication date when explicit; otherwise label it an undated reference with actual first observation. Attribute product and practitioner claims; do not treat a crawl as a launch, infer unreported outcomes, or assume historical discovery."
  },
  {
    "id": "google-ai-search-reference",
    "name": "Google Search — AI feature publisher guidance",
    "url": "https://developers.google.com/search/docs/appearance/ai-features",
    "kind": "web",
    "pageMode": "article",
    "category": "research",
    "enabled": true,
    "priority": 1,
    "notes": "Monitor this public first-party reference body. Preserve its original publication date when explicit; otherwise label it an undated reference with actual first observation. Attribute product and practitioner claims; do not treat a crawl as a launch, infer unreported outcomes, or assume historical discovery."
  },
  {
    "id": "google-search-original-updates",
    "name": "Google Search — original product and publisher updates",
    "url": "https://developers.google.com/search/blog",
    "kind": "web",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "notes": "Discover substantive public original articles from this publisher index. Preserve original dates and access limits; older articles are evergreen references, not new releases. Index coverage is limited to actually returned links, not all publisher history.",
    "articlePathPrefixes": [
      "/search/blog/"
    ]
  },
  {
    "id": "sparktoro-original-audience-research",
    "name": "SparkToro — original audience and search research",
    "url": "https://sparktoro.com/blog/",
    "kind": "web",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "notes": "Discover substantive public original articles from this publisher index. Preserve original dates and access limits; older articles are evergreen references, not new releases. Index coverage is limited to actually returned links, not all publisher history.",
    "articlePathPrefixes": [
      "/blog/"
    ]
  },
  {
    "id": "lenny-interview-resource-library",
    "name": "Lenny’s Jobs — public interview resource library",
    "url": "https://www.lennysjobs.com/interview-prep",
    "kind": "web",
    "pageMode": "article",
    "category": "practitioner",
    "enabled": true,
    "priority": 2,
    "notes": "Public resource-library identity and descriptions only. Preserve unknown publication date. Resource curation does not prove career or hiring outcomes; do not infer paid resource contents."
  },
  {
    "id": "trendtrack-original-growth-library",
    "name": "TrendTrack — original advertising research and growth methods",
    "url": "https://www.trendtrack.io/blog",
    "kind": "web",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "articlePathPrefixes": [
      "/blog-post/"
    ],
    "notes": "Public vendor research and operating choices. Separate documented free/paid capability boundaries from unverified MRR, growth attribution and competitor claims. Preserve original dates."
  },
  {
    "id": "ryze-public-marketing-permissions",
    "name": "Ryze — public marketing action permissions",
    "url": "https://help.get-ryze.ai/claude/permissions",
    "kind": "web",
    "pageMode": "article",
    "category": "industry",
    "enabled": true,
    "priority": 1,
    "notes": "Original public tool permissions. Stated capabilities and required human approval are first-party descriptions, not independent execution or effectiveness tests. Preserve unknown publication dates."
  },
  {
    "id": "ryze-public-managed-campaigns",
    "name": "Ryze — public campaign workflows",
    "url": "https://help.get-ryze.ai/paid-ads/managed-campaigns",
    "kind": "web",
    "pageMode": "article",
    "category": "industry",
    "enabled": true,
    "priority": 1,
    "notes": "Original public campaign workflow and platform scope. Attribute vendor claims and retain approval/availability conditions; never invent observed performance."
  },
  {
    "id": "a16z-original-media-practice",
    "name": "a16z — original media and distribution practice",
    "url": "https://a16z.com/what-is-new-media-in-2026/",
    "kind": "web",
    "pageMode": "article",
    "category": "practitioner",
    "enabled": true,
    "priority": 1,
    "notes": "Original practitioner argument about owned distribution, creator roles and trust. Treat recommendations as attributed perspectives, not proof of universal hiring order or exclusive durable moats."
  }
];
