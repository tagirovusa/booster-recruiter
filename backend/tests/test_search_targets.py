import pytest
from booster_recruiter.worker import direct_profile_search
from booster_linkedin.core.exceptions import InvalidReferenceError


@pytest.mark.parametrize(
    "keywords",
    [
        "driver recruitment",
        "sample-recruiter",
        "Sample Recruiter",
        "www.linkedin.com/in/candidate",
    ],
)
def test_keywords_are_never_implicitly_profile_identifiers(keywords):
    assert direct_profile_search(keywords) is None


@pytest.mark.parametrize(
    "url",
    [
        "https://www.linkedin.com/in/candidate/",
        "http://linkedin.com/in/candidate?trk=test",
    ],
)
def test_explicit_profile_url_is_one_normalized_target(url):
    assert direct_profile_search(url) == [
        {"url": "https://www.linkedin.com/in/candidate", "label": "candidate"}
    ]
    assert direct_profile_search(url, 2) == []


def test_unicode_profile_url_is_encoded_once():
    url = "https://www.linkedin.com/in/вымышленный-кандидат/"
    actual = direct_profile_search(url)[0]["url"]
    assert actual.startswith("https://www.linkedin.com/in/%D0%B2")
    assert "%25" not in actual
    assert direct_profile_search(actual)[0]["url"] == actual


@pytest.mark.parametrize(
    "url",
    [
        "https://example.invalid/in/candidate",
        "https://linkedin.com.example.invalid/in/candidate",
        "https://www.linkedin.com/in/me/",
        "https://www.linkedin.com/company/example",
        "https://www.linkedin.com/in/candidate/details/",
        "https://user:password@www.linkedin.com/in/candidate",
        "https://www.linkedin.com:8443/in/candidate",
        "https://www.linkedin.com/in/candidate%2Fother",
        "https://www.linkedin.com/in/bad%ZZ",
        "https:/www.linkedin.com/in/candidate",
    ],
)
def test_invalid_explicit_url_never_becomes_an_external_navigation_target(url):
    with pytest.raises((ValueError, InvalidReferenceError)):
        direct_profile_search(url)
