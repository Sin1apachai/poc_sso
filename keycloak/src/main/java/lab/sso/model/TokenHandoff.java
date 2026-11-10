package lab.sso.model;

/** A delivery response for one application; accessToken is the existing central JWT. */
public record TokenHandoff(String callbackUrl, String state, String accessToken, String deliveryProof) {
}
