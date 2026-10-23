import twitterText from "twitter-text";

export function countTwitterCharacters(text: string): number {
  return twitterText.parseTweet(text).weightedLength;
}
