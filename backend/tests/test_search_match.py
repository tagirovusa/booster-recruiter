from booster_recruiter.search_match import compile_query, matches


def person(text, **extra):
    return {"name": "X", "sections": {"main_profile": text}, **extra}


QUERY = (
    '"driver recruiter" AND "trucking" AND ("optimizing recruiting" OR '
    '"recruit qualified drivers" OR "Overseeing driver recruitment")'
)


def test_word_forms_and_phrases():
    q = compile_query(QUERY)
    assert matches(
        q,
        person(
            "Driving Results in Driver Recruiting. 30 years in trucking, "
            "optimizing recruiting efficiency."
        ),
    )
    assert not matches(q, person("Love Always Wins. Dynamic Dedicated LLC"))


def test_other_peoples_sidebar_text_does_not_count():
    q = compile_query('"it recruiter"')
    text = "Python developer\nExplore Premium profiles\nIT Recruiter at Acme"
    assert not matches(q, person(text))


def test_implicit_and_not_and_brackets():
    q = compile_query("tech recruiter NOT intern")
    assert matches(q, person("Tech recruiter at Acme"))
    assert not matches(q, person("Tech recruiter intern"))
    assert not matches(q, person("Tech lead"))
    q = compile_query('(manager OR director) "driver recruitment"')
    assert matches(q, person("Director of Driver Recruitment"))


def test_unparsable_query_is_not_filtered():
    assert compile_query('("open bracket') is None
    assert matches(None, person("anything"))
